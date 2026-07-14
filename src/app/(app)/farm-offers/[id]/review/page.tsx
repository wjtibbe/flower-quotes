import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { suggestProductVariant } from "@/lib/import/aliasMatching";
import { updateOfferLine, deleteOfferLine, addManualOfferLine, markOfferReviewed } from "../../actions";

export const dynamic = "force-dynamic";

const CONFIDENCE_BADGE: Record<string, string> = {
  HIGH: "badge-high",
  MEDIUM: "badge-medium",
  LOW: "badge-low",
};
const CONFIDENCE_LABEL: Record<string, string> = { HIGH: "hoog", MEDIUM: "middel", LOW: "laag" };

export default async function ReviewFarmOfferPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { fatal?: string };
}) {
  const offer = await prisma.farmOffer.findUnique({
    where: { id: params.id },
    include: { farm: true, lines: { orderBy: { createdAt: "asc" } }, sourceUpload: true },
  });
  if (!offer) notFound();

  const variants = await prisma.productVariant.findMany({
    where: { active: true },
    include: { product: true },
    orderBy: { createdAt: "asc" },
  });

  const suggestionsPerLine = await Promise.all(
    offer.lines.map((line) =>
      suggestProductVariant({
        productGroupRaw: line.productGroupRaw ?? undefined,
        varietyRaw: line.varietyRaw ?? undefined,
        colorRaw: line.colorRaw ?? undefined,
        gradeRaw: line.gradeRaw ?? undefined,
      }),
    ),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Importresultaat controleren</h1>
        <p className="text-sm text-gray-500 mt-1">
          {offer.title} {offer.farm ? `· ${offer.farm.name}` : ""} · {offer.lines.length} regels herkend
        </p>
        {searchParams.fatal && (
          <p className="text-sm text-red-600 mt-2">
            Automatisch uitlezen is mislukt: {searchParams.fatal}. Voeg de regels hieronder handmatig toe.
          </p>
        )}
      </div>

      <div className="space-y-4">
        {offer.lines.map((line, idx) => {
          const suggestions = suggestionsPerLine[idx];
          return (
            <div key={line.id} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <span className={CONFIDENCE_BADGE[line.confidence]}>
                  Betrouwbaarheid: {CONFIDENCE_LABEL[line.confidence]}
                </span>
                <span className="text-xs text-gray-400 truncate max-w-md" title={line.rawText}>
                  Bron: “{line.rawText}”
                </span>
              </div>

              <form action={updateOfferLine.bind(null, line.id)} className="grid grid-cols-4 gap-3">
                <Field label="Leverancier (tekst)" name="farmNameRaw" defaultValue={line.farmNameRaw ?? ""} />
                <Field label="Land van herkomst" name="countryOfOrigin" defaultValue={line.countryOfOrigin ?? ""} />
                <Field label="Productgroep" name="productGroupRaw" defaultValue={line.productGroupRaw ?? ""} />
                <Field label="Variëteit" name="varietyRaw" defaultValue={line.varietyRaw ?? ""} />
                <Field label="Kleur" name="colorRaw" defaultValue={line.colorRaw ?? ""} />
                <Field label="Kwaliteit/grade" name="gradeRaw" defaultValue={line.gradeRaw ?? ""} />
                <Field label="Behandeling" name="treatmentRaw" defaultValue={line.treatmentRaw ?? "normal"} />
                <Field label="Box type" name="boxType" defaultValue={line.boxType ?? "QB"} />
                <Field label="Dozen beschikbaar" name="boxesAvailable" type="number" defaultValue={line.boxesAvailable ?? ""} />
                <Field label="Stelen per doos" name="stemsPerBox" type="number" defaultValue={line.stemsPerBox ?? ""} />
                <Field
                  label="FOB-prijs per steel"
                  name="fobPricePerStem"
                  type="number"
                  step="0.0001"
                  defaultValue={line.fobPricePerStem?.toString() ?? ""}
                />
                <div>
                  <label className="label">Valuta</label>
                  <select name="currency" className="input" defaultValue={line.currency}>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <Field
                    label="Gewicht per doos (kg)"
                    name="weightPerBoxKg"
                    type="number"
                    step="0.001"
                    defaultValue={line.weightPerBoxKg?.toString() ?? ""}
                  />
                  {!line.weightPerBoxKg && line.productVariantId && (
                    <p className="text-xs text-amber-600 mt-1">
                      Geen gewichtsprofiel gevonden voor deze combinatie - vul handmatig in.
                    </p>
                  )}
                  <label className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                    <input type="checkbox" name="saveAsWeightProfile" />
                    Bewaar als gewichtsprofiel
                  </label>
                </div>

                <div className="col-span-2">
                  <label className="label">
                    Centraal product {suggestions.length > 0 && <span className="text-brand-600">(suggestie beschikbaar)</span>}
                  </label>
                  <select name="productVariantId" className="input" defaultValue={line.productVariantId ?? ""}>
                    <option value="">Nog niet gekoppeld</option>
                    {suggestions.map((s) => (
                      <option key={`s-${s.productVariantId}`} value={s.productVariantId}>
                        ★ {s.label} ({Math.round(s.score * 100)}% match)
                      </option>
                    ))}
                    {variants
                      .filter((v) => !suggestions.some((s) => s.productVariantId === v.id))
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.product.name}
                          {v.color ? ` - ${v.color}` : ""}
                          {v.grade ? ` - ${v.grade}` : ""}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="label">Opmerkingen</label>
                  <input name="notes" className="input" defaultValue={line.notes ?? ""} />
                </div>

                <div className="col-span-4 flex items-center justify-between pt-2 border-t border-gray-100">
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" name="stillNeedsReview" defaultChecked={line.needsReview} />
                    Nog te controleren (blijft gemarkeerd)
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary py-1.5 px-3 text-sm">
                      Opslaan
                    </button>
                  </div>
                </div>
              </form>
              <form action={deleteOfferLine.bind(null, offer.id, line.id)} className="mt-1">
                <button className="text-xs text-red-500 hover:underline">Regel verwijderen</button>
              </form>
            </div>
          );
        })}

        {offer.lines.length === 0 && (
          <div className="card p-6 text-center text-gray-400">
            Geen regels herkend uit dit bestand. Voeg hieronder handmatig regels toe.
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Handmatig regel toevoegen</h2>
        <form action={addManualOfferLine.bind(null, offer.id)} className="grid grid-cols-4 gap-3">
          <Field label="Productgroep" name="productGroupRaw" />
          <Field label="Variëteit" name="varietyRaw" />
          <Field label="Kleur" name="colorRaw" />
          <Field label="Kwaliteit/grade" name="gradeRaw" />
          <Field label="Box type" name="boxType" defaultValue="QB" />
          <Field label="Dozen beschikbaar" name="boxesAvailable" type="number" />
          <Field label="Stelen per doos" name="stemsPerBox" type="number" />
          <Field label="FOB-prijs per steel" name="fobPricePerStem" type="number" step="0.0001" />
          <Field label="Gewicht per doos (kg)" name="weightPerBoxKg" type="number" step="0.001" />
          <div className="col-span-4">
            <button className="btn-secondary" type="submit">
              + Regel toevoegen
            </button>
          </div>
        </form>
      </div>

      <form action={markOfferReviewed.bind(null, offer.id)}>
        <button className="btn-primary">Markeer als gecontroleerd</button>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  step,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  defaultValue?: string | number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type={type} step={step} name={name} className="input" defaultValue={defaultValue} />
    </div>
  );
}
