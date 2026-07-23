"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { LineMatchStatus } from "@prisma/client";
import {
  buildProfileUpdate,
  buildVariantUpdate,
  hasAnyEdit,
  validateBulkEdit,
  type BulkEditInput,
} from "@/lib/bulkSelection";
import { randomUUID } from "node:crypto";
import { blockedDeleteMessage } from "@/lib/deletionMessage";
import { MAX_BULK } from "@/lib/bulkIds";
import type { ActionResult } from "@/lib/actionResult";
import {
  isHeaderRow,
  parseAssortmentPasteRow,
  splitArticle,
  matchFarm,
} from "@/lib/import/assortmentPaste";

function norm(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/** Result of a bulk action, surfaced by the client as a success/error toast. */
export type BulkActionResult = ActionResult;

/**
 * Validates a list of selected supplier-link ids: non-empty, within the cap,
 * de-duplicated, and every id must still exist. Returns the clean id list or
 * an error message, so a bulk action never does a partial write on a stale
 * selection.
 */
async function validateBulkIds(ids: string[]): Promise<{ ids: string[] } | { error: string }> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return { error: "Geen artikelen geselecteerd." };
  if (unique.length > MAX_BULK) return { error: `Maximaal ${MAX_BULK} artikelen per bulkactie.` };

  const found = await prisma.packagingWeightProfile.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    return { error: "Sommige geselecteerde artikelen bestaan niet meer. Ververs de pagina en probeer opnieuw." };
  }
  return { ids: unique };
}

/**
 * Bulk-updates the selected supplier links. Only the fields the user enabled
 * are written (see buildProfileUpdate/buildVariantUpdate); every other value
 * on every article is left untouched. Length lives on the shared central
 * ProductVariant, so it is applied to the distinct variants of the selection.
 * All writes run in one transaction - no partial update on error.
 */
export async function bulkUpdateSupplierLinks(ids: string[], edit: BulkEditInput): Promise<BulkActionResult> {
  const validation = await validateBulkIds(ids);
  if ("error" in validation) return { ok: false, message: validation.error };

  if (!hasAnyEdit(edit)) return { ok: false, message: "Kies minstens één veld om te wijzigen." };
  const validationError = validateBulkEdit(edit);
  if (validationError) return { ok: false, message: validationError };

  const profileData = buildProfileUpdate(edit);
  const variantData = buildVariantUpdate(edit);

  const ops = [];
  if (Object.keys(profileData).length > 0) {
    ops.push(prisma.packagingWeightProfile.updateMany({ where: { id: { in: validation.ids } }, data: profileData }));
  }
  if (Object.keys(variantData).length > 0) {
    const profiles = await prisma.packagingWeightProfile.findMany({
      where: { id: { in: validation.ids } },
      select: { productVariantId: true },
    });
    const variantIds = [...new Set(profiles.map((p) => p.productVariantId))];
    ops.push(prisma.productVariant.updateMany({ where: { id: { in: variantIds } }, data: variantData }));
  }

  if (ops.length === 0) return { ok: false, message: "Kies minstens één veld om te wijzigen." };

  await prisma.$transaction(ops);
  revalidatePath("/products");
  revalidatePath("/weight-profiles");
  return { ok: true, message: `${validation.ids.length} artikel(en) bijgewerkt.` };
}

/**
 * Bulk-duplicates the selected supplier links: one fresh record per article,
 * copying box/weight/stems/code/notes/variant but never the id or timestamps.
 * Created in one transaction.
 */
export async function bulkDuplicateSupplierLinks(ids: string[]): Promise<BulkActionResult> {
  const validation = await validateBulkIds(ids);
  if ("error" in validation) return { ok: false, message: validation.error };

  const sources = await prisma.packagingWeightProfile.findMany({ where: { id: { in: validation.ids } } });
  await prisma.$transaction(
    sources.map((s) =>
      prisma.packagingWeightProfile.create({
        data: {
          farmId: s.farmId,
          productVariantId: s.productVariantId,
          supplierCode: s.supplierCode,
          boxType: s.boxType,
          stemsPerBox: s.stemsPerBox,
          weightPerBoxKg: s.weightPerBoxKg,
          notes: s.notes,
        },
      }),
    ),
  );
  revalidatePath("/products");
  return { ok: true, message: `${sources.length} artikel(en) succesvol gedupliceerd.` };
}

/**
 * Bulk-deletes the selected supplier links (assortment rows are leaf records,
 * so this is a real delete). Single deleteMany, no per-item request.
 *
 * Any `FarmOfferLine` still linked to one of these profiles is updated in
 * the SAME transaction, before the delete: the database's own FK
 * (`onDelete: SetNull`) already nulls `packagingWeightProfileId` once the row
 * is gone, but it cannot also flip `matchStatus` back to UNMATCHED - a
 * database trigger isn't used for this (deliberately; see the review-step
 * report), so the application does it explicitly here (section 25).
 * `productVariantId` is left untouched: it still points at the (still
 * existing) `ProductVariant`, which stays semantically correct even once
 * this specific packaging profile is gone - only the packaging-specific link
 * disappears.
 */
export async function bulkDeleteSupplierLinks(ids: string[]): Promise<BulkActionResult> {
  const validation = await validateBulkIds(ids);
  if ("error" in validation) return { ok: false, message: validation.error };

  const res = await prisma.$transaction(async (tx) => {
    await tx.farmOfferLine.updateMany({
      where: { packagingWeightProfileId: { in: validation.ids } },
      data: { packagingWeightProfileId: null, matchStatus: LineMatchStatus.UNMATCHED },
    });
    return tx.packagingWeightProfile.deleteMany({ where: { id: { in: validation.ids } } });
  });
  revalidatePath("/products");
  return { ok: true, message: `${res.count} artikel(en) verwijderd.` };
}

/**
 * Creates a central assortment product: product (name) + variety + length.
 * Duplicate-safe: an existing Product with the same name (case-insensitive)
 * is reused, and if an identical variant (variety + length, no
 * color/grade/treatment) already exists the action redirects with a
 * "bestaat al" message instead of creating a duplicate.
 */
export async function createCentralProduct(formData: FormData): Promise<void> {
  const name = norm(formData.get("name"));
  const productGroup = norm(formData.get("productGroup")) ?? name;
  const variety = norm(formData.get("variety"));
  const stemLength = norm(formData.get("stemLength"));
  if (!name) throw new Error("Product is verplicht");

  let product = await prisma.product.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (!product) {
    product = await prisma.product.create({ data: { name, productGroup: productGroup! } });
  }

  const existing = await prisma.productVariant.findFirst({
    where: {
      productId: product.id,
      variety: variety ? { equals: variety, mode: "insensitive" } : null,
      stemLength: stemLength ? { equals: stemLength, mode: "insensitive" } : null,
      color: null,
      grade: null,
      treatment: null,
    },
  });
  if (existing) {
    redirect("/products?msg=exists");
  }

  await prisma.productVariant.create({ data: { productId: product.id, variety, stemLength } });
  revalidatePath("/products");
  redirect("/products?msg=created");
}

/**
 * Bulk-creates supplier-assortment rows from a pasted list, one row per
 * line: "Omschrijving<TAB or ,>Stelen per doos" optionally followed by
 * doostype, doosgewicht, leverancierscode, notities en lengte to override the
 * shared defaults set above the textarea. The central product is shared
 * across all lines (reused if it already exists, by name); each line's
 * description becomes the variant's "variety" text as-is (no attempt to
 * split it into color/grade - the source price lists this is meant for
 * already combine those into one descriptive name). Lengte is stored on its
 * own field (ProductVariant.stemLength), not folded into the description.
 *
 * Safe to re-run on the same paste: an existing variant (same omschrijving +
 * lengte) is reused rather than duplicated, and a line whose (leverancier,
 * variant, doostype, stelen/doos) combination already exists is skipped
 * instead of duplicated.
 */
export async function bulkAddAssortment(formData: FormData): Promise<void> {
  const farmId = norm(formData.get("farmId"));
  const productName = norm(formData.get("productName"));
  const productGroup = norm(formData.get("productGroup")) ?? productName;
  const defaultBoxType = norm(formData.get("boxType")) ?? "QB";
  const defaultWeightPerBoxKg = norm(formData.get("weightPerBoxKg"));
  const defaultStemLength = norm(formData.get("stemLength"));
  const rowsRaw = String(formData.get("rows") ?? "");

  if (!farmId || !productName) throw new Error("Leverancier en product zijn verplicht");

  let product = await prisma.product.findFirst({
    where: { name: { equals: productName, mode: "insensitive" } },
  });
  if (!product) {
    product = await prisma.product.create({ data: { name: productName, productGroup: productGroup! } });
  }

  let created = 0;
  let duplicates = 0;
  let invalid = 0;

  const lines = rowsRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    const variety = cols[0] || null;
    const stemsPerBox = parseInt(cols[1] ?? "", 10);
    const boxType = cols[2] || defaultBoxType;
    const weightPerBoxKg = cols[3] || defaultWeightPerBoxKg;
    const supplierCode = cols[4] || null;
    const notes = cols[5] || null;
    const stemLength = cols[6] || defaultStemLength;

    if (!variety || !Number.isFinite(stemsPerBox) || stemsPerBox <= 0 || !weightPerBoxKg) {
      invalid++;
      continue;
    }

    let variant = await prisma.productVariant.findFirst({
      where: {
        productId: product.id,
        variety: { equals: variety, mode: "insensitive" },
        stemLength: stemLength ? { equals: stemLength, mode: "insensitive" } : null,
        color: null,
        grade: null,
        treatment: null,
      },
    });
    if (!variant) {
      variant = await prisma.productVariant.create({ data: { productId: product.id, variety, stemLength } });
    }

    const existingLink = await prisma.packagingWeightProfile.findFirst({
      where: { farmId, productVariantId: variant.id, boxType, stemsPerBox },
    });
    if (existingLink) {
      duplicates++;
      continue;
    }

    await prisma.packagingWeightProfile.create({
      data: { farmId, productVariantId: variant.id, boxType, stemsPerBox, weightPerBoxKg, supplierCode, notes },
    });
    created++;
  }

  revalidatePath("/products");
  redirect(`/products?msg=bulk&created=${created}&dup=${duplicates}&invalid=${invalid}`);
}

/**
 * Bulk-imports assortment rows from a paste that spans multiple suppliers, one
 * variety per line:
 *   Leverancier <TAB> Inkoop Artikel <TAB> Lengte <TAB> Doos <TAB> Stelen/doos <TAB> KG/doos
 * The supplier is matched to an existing farm by name (tolerant of legal
 * suffixes/punctuation - never auto-created); the article is split into a
 * central product + variety (see splitArticle). Products and variants are
 * reused when they already exist (by name / variety+length), and a line whose
 * (leverancier, variant, doostype, stelen/doos) combination already exists is
 * skipped, so re-pasting the same list makes no duplicates. Rows for an
 * unknown supplier are collected and reported instead of silently dropped.
 */
export async function bulkAddAssortmentMultiSupplier(formData: FormData): Promise<void> {
  const rowsRaw = String(formData.get("rows") ?? "");
  const lines = rowsRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Load every lookup once instead of querying per row: a paste can be many
  // thousands of lines, and a query-per-row would take far longer than a
  // request may run (the page would appear to hang). Everything below resolves
  // in memory and only writes happen, in batched createMany calls.
  const [farms, products, variants, existingLinks] = await Promise.all([
    prisma.farm.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({ select: { id: true, name: true } }),
    prisma.productVariant.findMany({
      select: { id: true, productId: true, variety: true, stemLength: true, color: true, grade: true, treatment: true },
    }),
    prisma.packagingWeightProfile.findMany({
      select: { farmId: true, productVariantId: true, boxType: true, stemsPerBox: true },
    }),
  ]);

  const SEP = " ";
  const productIdByName = new Map<string, string>();
  for (const p of products) productIdByName.set(p.name.toLowerCase(), p.id);

  const variantKey = (productId: string, variety: string, stemLength: string | null) =>
    `${productId}${SEP}${variety.toLowerCase()}${SEP}${(stemLength ?? "").toLowerCase()}`;
  const variantIdByKey = new Map<string, string>();
  for (const v of variants) {
    // Only plain assortment variants (no color/grade/treatment) are reuse targets.
    if (v.color === null && v.grade === null && v.treatment === null) {
      variantIdByKey.set(variantKey(v.productId, v.variety ?? "", v.stemLength), v.id);
    }
  }

  const linkKey = (farmId: string, variantId: string, boxType: string, stems: number) =>
    `${farmId}${SEP}${variantId}${SEP}${boxType}${SEP}${stems}`;
  const seenLinks = new Set(existingLinks.map((l) => linkKey(l.farmId, l.productVariantId, l.boxType, l.stemsPerBox)));

  const newProducts: { id: string; name: string; productGroup: string }[] = [];
  const newVariants: { id: string; productId: string; variety: string; stemLength: string | null }[] = [];
  const newLinks: { farmId: string; productVariantId: string; boxType: string; stemsPerBox: number; weightPerBoxKg: string }[] = [];

  let created = 0;
  let duplicates = 0;
  let invalid = 0;
  const unmatched = new Set<string>();

  for (const line of lines) {
    if (isHeaderRow(line)) continue;
    const row = parseAssortmentPasteRow(line);
    if (!row) {
      invalid++;
      continue;
    }
    const farm = matchFarm(farms, row.supplierName);
    if (!farm) {
      unmatched.add(row.supplierName);
      continue;
    }
    const split = splitArticle(row.article);
    if (!split) {
      invalid++;
      continue;
    }

    let productId = productIdByName.get(split.productName.toLowerCase());
    if (!productId) {
      productId = randomUUID();
      productIdByName.set(split.productName.toLowerCase(), productId);
      newProducts.push({ id: productId, name: split.productName, productGroup: split.productName });
    }

    const vKey = variantKey(productId, split.variety, row.stemLength);
    let variantId = variantIdByKey.get(vKey);
    if (!variantId) {
      variantId = randomUUID();
      variantIdByKey.set(vKey, variantId);
      newVariants.push({ id: variantId, productId, variety: split.variety, stemLength: row.stemLength });
    }

    const lKey = linkKey(farm.id, variantId, row.boxType, row.stemsPerBox);
    if (seenLinks.has(lKey)) {
      duplicates++;
      continue;
    }
    seenLinks.add(lKey);
    newLinks.push({
      farmId: farm.id,
      productVariantId: variantId,
      boxType: row.boxType,
      stemsPerBox: row.stemsPerBox,
      weightPerBoxKg: row.weightPerBoxKg,
    });
    created++;
  }

  // Write in dependency order (products -> variants -> links), batched so no
  // single statement grows unbounded. skipDuplicates guards against a racing
  // concurrent import.
  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };
  for (const batch of chunk(newProducts, 500)) await prisma.product.createMany({ data: batch, skipDuplicates: true });
  for (const batch of chunk(newVariants, 500)) await prisma.productVariant.createMany({ data: batch, skipDuplicates: true });
  for (const batch of chunk(newLinks, 1000)) await prisma.packagingWeightProfile.createMany({ data: batch, skipDuplicates: true });

  revalidatePath("/products");
  // Keep the redirect URL bounded even when many distinct suppliers are unknown.
  const unmatchedList = [...unmatched];
  const unmatchedShown = unmatchedList.slice(0, 20).join(", ") + (unmatchedList.length > 20 ? ` en nog ${unmatchedList.length - 20}` : "");
  const unmatchedParam = unmatched.size > 0 ? `&unmatched=${encodeURIComponent(unmatchedShown)}` : "";
  redirect(`/products?msg=multibulk&created=${created}&dup=${duplicates}&invalid=${invalid}${unmatchedParam}`);
}

/** Links a supplier to an existing central product (creates a supplier-assortment row). */
export async function addSupplierLink(formData: FormData): Promise<void> {
  const farmId = norm(formData.get("farmId"));
  const productVariantId = norm(formData.get("productVariantId"));
  const boxType = norm(formData.get("boxType")) ?? "QB";
  const stemsPerBox = parseInt(String(formData.get("stemsPerBox") ?? ""), 10);
  const weightPerBoxKg = norm(formData.get("weightPerBoxKg"));
  if (!farmId || !productVariantId || !Number.isFinite(stemsPerBox) || stemsPerBox <= 0 || !weightPerBoxKg) {
    throw new Error("Leverancier, product, stelen per doos en doosgewicht zijn verplicht");
  }

  await prisma.packagingWeightProfile.create({
    data: {
      farmId,
      productVariantId,
      supplierCode: norm(formData.get("supplierCode")),
      boxType,
      stemsPerBox,
      weightPerBoxKg,
      notes: norm(formData.get("notes")),
    },
  });
  revalidatePath("/products");
  revalidatePath("/weight-profiles");
}

/** Updates an existing supplier link in place. */
export async function updateSupplierLink(id: string, formData: FormData): Promise<void> {
  const stemsPerBox = parseInt(String(formData.get("stemsPerBox") ?? ""), 10);
  const weightPerBoxKg = norm(formData.get("weightPerBoxKg"));
  if (!Number.isFinite(stemsPerBox) || stemsPerBox <= 0 || !weightPerBoxKg) {
    throw new Error("Stelen per doos en doosgewicht zijn verplicht");
  }

  await prisma.packagingWeightProfile.update({
    where: { id },
    data: {
      farmId: norm(formData.get("farmId")) ?? undefined,
      supplierCode: norm(formData.get("supplierCode")),
      boxType: norm(formData.get("boxType")) ?? "QB",
      stemsPerBox,
      weightPerBoxKg,
      notes: norm(formData.get("notes")),
    },
  });
  revalidatePath("/products");
  revalidatePath("/weight-profiles");
}

/**
 * Duplicates an existing supplier link for a different (or same) supplier:
 * copies box/weight/stems/code/notes, with the supplier chosen in the form.
 */
export async function duplicateSupplierLink(id: string, formData: FormData): Promise<void> {
  const farmId = norm(formData.get("farmId"));
  if (!farmId) throw new Error("Kies een leverancier voor de kopie");

  const source = await prisma.packagingWeightProfile.findUniqueOrThrow({ where: { id } });
  await prisma.packagingWeightProfile.create({
    data: {
      farmId,
      productVariantId: source.productVariantId,
      supplierCode: source.supplierCode,
      boxType: source.boxType,
      stemsPerBox: source.stemsPerBox,
      weightPerBoxKg: source.weightPerBoxKg,
      notes: source.notes,
    },
  });
  revalidatePath("/products");
  revalidatePath("/weight-profiles");
}

/**
 * Hard-deletes a single supplier link (assortment row is a leaf record).
 * See `bulkDeleteSupplierLinks` for why linked `FarmOfferLine`s are updated
 * to UNMATCHED in the same transaction, before the delete (section 25).
 */
export async function deleteSupplierLink(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.farmOfferLine.updateMany({
      where: { packagingWeightProfileId: id },
      data: { packagingWeightProfileId: null, matchStatus: LineMatchStatus.UNMATCHED },
    });
    await tx.packagingWeightProfile.delete({ where: { id } });
  });
  revalidatePath("/products");
}

// --- existing central-product management actions (aliases, variants) ---

export async function addProductAlias(productId: string, formData: FormData): Promise<void> {
  const alias = String(formData.get("alias") ?? "").trim();
  if (!alias) return;
  await prisma.productAlias.upsert({
    where: { productId_alias: { productId, alias } },
    update: {},
    create: { productId, alias },
  });
  revalidatePath("/products");
}

export async function removeProductAlias(id: string): Promise<void> {
  await prisma.productAlias.delete({ where: { id } });
  revalidatePath("/products");
}

/**
 * Hard-deletes a central product variant. Blocked (with a clear message) when
 * the variant is still used by assortment rows or by parsed offer lines, so
 * referential integrity is preserved.
 */
export async function deleteVariant(id: string): Promise<void> {
  const [assortment, offerLines] = await Promise.all([
    prisma.packagingWeightProfile.count({ where: { productVariantId: id } }),
    prisma.farmOfferLine.count({ where: { productVariantId: id } }),
  ]);
  const blocked = blockedDeleteMessage("Dit product", [
    { count: assortment, label: "assortimentregel(s)" },
    { count: offerLines, label: "aanbiedingsregel(s)" },
  ]);
  if (blocked) redirect(`/products?err=${encodeURIComponent(blocked)}`);

  await prisma.productVariant.delete({ where: { id } });
  revalidatePath("/products");
  redirect("/products?msg=variant-deleted");
}
