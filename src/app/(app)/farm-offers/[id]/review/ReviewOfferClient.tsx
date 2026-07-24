"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssortmentMatchOption } from "@/lib/import/matching/assortmentMatch";
import type { ActionResult } from "@/lib/actionResult";
import {
  updateOfferLine,
  deleteOfferLine,
  addManualOfferLine,
  bulkAddOfferLines,
  selectPackagingProfile,
  createAssortmentItemFromOfferLine,
  confirmFarmOffer,
  saveSupplierLineMapping,
} from "../../actions";
import { OfferLineReviewRow } from "./OfferLineReviewRow";
import { MatchSelectionModal } from "./MatchSelectionModal";
import { CreateAssortmentModal } from "./CreateAssortmentModal";
import {
  REVIEW_FILTER_LABELS,
  computeReviewFilterCounts,
  defaultReviewFilter,
  filterReviewLines,
  reviewFilterEmptyMessage,
} from "./reviewFilters";
import type { ReviewFilter } from "./reviewFilters";

/** Plain-data view of one FarmOfferLine, pre-computed server-side (Decimal fields as strings, enums as plain strings) so this whole subtree can be a Client Component. */
export interface OfferLineViewModel {
  id: string;
  rawText: string;
  productGroupRaw: string | null;
  productNameRaw: string | null;
  varietyRaw: string | null;
  colorRaw: string | null;
  gradeRaw: string | null;
  treatmentRaw: string | null;
  boxType: string | null;
  boxesAvailable: number | null;
  stemsPerBox: number | null;
  stemLengthCm: number | null;
  quantity: string | null;
  unit: string | null;
  totalStems: number | null;
  fobPricePerStem: string | null;
  currency: string;
  weightPerBoxKg: string | null;
  notes: string | null;
  matchStatus: string;
  matchedOption: AssortmentMatchOption | null;
  matchOptions: AssortmentMatchOption[];
  validationWarnings: string[];
  validationErrors: string[];
  extractedSnapshot: Record<string, unknown> | null;
  /** Section 23: display-only hint - USER_LINKED via a saved supplier mapping rather than a direct manual choice. Never persisted. */
  matchedViaSupplierMapping: boolean;
  /** Section 7: "Save as supplier mapping" is only offered when there's real supplier text and a confirmed assortment link. */
  canSaveAsSupplierMapping: boolean;
}

interface Props {
  offerId: string;
  offerTitle: string | null;
  farmId: string | null;
  farmName: string | null;
  offerStatus: string;
  lines: OfferLineViewModel[];
  allAssortmentOptions: AssortmentMatchOption[];
  fatalMessage: string | null;
  bulkMessage: { added: number; invalid: number } | null;
}

type ModalState = null | { kind: "match"; lineId: string } | { kind: "create"; lineId: string };

export function ReviewOfferClient({
  offerId,
  offerTitle,
  farmId,
  farmName,
  offerStatus,
  lines,
  allAssortmentOptions,
  fatalMessage,
  bulkMessage,
}: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  // Set synchronously on click, BEFORE startTransition - `isPending` from
  // useTransition only becomes true once React commits the update, which can
  // lag behind a rapid double-click; this flag closes that gap so the button
  // is guaranteed disabled on the very next render, not just eventually.
  const [confirming, setConfirming] = useState(false);

  const counts = useMemo(() => computeReviewFilterCounts(lines), [lines]);

  // Computed once, from a lazy initializer, so it opens on "Needs attention"
  // when the offer has problems (section 1C) but is never silently reset
  // back to that default on a later render just because `lines` changed
  // (e.g. after a save) - the user's own filter choice persists across
  // fixes during the review session (section 1E).
  const [filter, setFilter] = useState<ReviewFilter>(() => defaultReviewFilter(computeReviewFilterCounts(lines)));
  const filteredLines = useMemo(() => filterReviewLines(lines, filter), [lines, filter]);

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    if (isPending) return;
    startTransition(async () => {
      const result = await action();
      setToast(result);
      if (result.ok) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  /**
   * Confirm offer (streamline-reviewed-workflow fix): a dedicated handler,
   * not the generic `run()`, for two reasons -
   *  1. Success navigates AWAY to the reviewed detail page (Task 3) instead
   *     of refreshing the current (review) route, so it must never also call
   *     `router.refresh()` on the page it's about to leave.
   *  2. `confirmFarmOffer` is now hardened server-side (actions.ts) to
   *     always resolve to an `ActionResult`, but a network-level failure
   *     (the fetch to the Server Action itself rejecting) still can't be
   *     ruled out client-side - the try/catch here guarantees `confirming`
   *     is always reset and an error is always shown, so the button can
   *     never stay stuck disabled with no feedback (Task 4).
   */
  function handleConfirm() {
    if (isPending || confirming) return;
    setConfirming(true);
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = await confirmFarmOffer(offerId);
      } catch {
        result = { ok: false, message: "Bevestigen is mislukt. Probeer het opnieuw." };
      }
      if (result.ok) {
        // Only reachable after successful finalization - stays on the review
        // page with the error shown otherwise (Task 3's explicit requirement).
        router.push(`/farm-offers/${offerId}`);
        return;
      }
      setToast(result);
      setConfirming(false);
    });
  }

  const activeLine = modal ? (lines.find((l) => l.id === modal.lineId) ?? null) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Importresultaat controleren</h1>
        <p className="text-sm text-gray-500 mt-1">
          {offerTitle} {farmName ? `· ${farmName}` : ""} · {lines.length} regels herkend
        </p>
        {fatalMessage && (
          <p className="text-sm text-red-600 mt-2">
            Automatisch uitlezen is mislukt: {fatalMessage}. Voeg de regels hieronder handmatig toe, of plak een
            lijst met het formulier onderaan deze pagina.
          </p>
        )}
      </div>

      {toast && (
        <div
          className={`card p-3 text-sm ${
            toast.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="text-xs text-gray-500 hover:underline">
              sluiten
            </button>
          </div>
        </div>
      )}

      {bulkMessage && (
        <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">
          {bulkMessage.added} regel(s) toegevoegd
          {bulkMessage.invalid > 0 && `, ${bulkMessage.invalid} regel(s) ongeldig (overgeslagen)`}.
        </div>
      )}

      <div className="card p-4 flex flex-wrap items-center gap-x-2 gap-y-2 sticky top-2 z-10 shadow-md">
        <FilterStat filter="ALL" label={REVIEW_FILTER_LABELS.ALL} value={counts.all} active={filter} onSelect={setFilter} />
        <FilterStat
          filter="NEEDS_ATTENTION"
          label={REVIEW_FILTER_LABELS.NEEDS_ATTENTION}
          value={counts.needsAttention}
          tone="red"
          active={filter}
          onSelect={setFilter}
        />
        <FilterStat filter="READY" label={REVIEW_FILTER_LABELS.READY} value={counts.ready} tone="green" active={filter} onSelect={setFilter} />
        <FilterStat filter="BLOCKING" label="Blocking errors" value={counts.blocking} tone="red" active={filter} onSelect={setFilter} />
        <FilterStat filter="WARNINGS" label={REVIEW_FILTER_LABELS.WARNINGS} value={counts.warnings} tone="amber" active={filter} onSelect={setFilter} />
        <FilterStat filter="UNMATCHED" label={REVIEW_FILTER_LABELS.UNMATCHED} value={counts.unmatched} tone="gray" active={filter} onSelect={setFilter} />
        <div className="flex-1" />
        {offerStatus === "REVIEWED" ? (
          <span className="badge badge-auto-matched">Reviewed</span>
        ) : (
          <button
            className="btn-primary"
            disabled={isPending || confirming || counts.blocking > 0 || lines.length === 0}
            title={counts.blocking > 0 ? "Los eerst alle blokkerende fouten op" : undefined}
            onClick={handleConfirm}
          >
            {confirming ? "Offer bevestigen..." : "Confirm offer"}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {filteredLines.map((line) => (
          <OfferLineReviewRow
            key={line.id}
            line={line}
            isPending={isPending}
            onSave={(formData) => run(() => updateOfferLine(line.id, formData))}
            onDelete={() => run(() => deleteOfferLine(offerId, line.id))}
            onChooseMatch={() => setModal({ kind: "match", lineId: line.id })}
            onCreateAssortment={() => setModal({ kind: "create", lineId: line.id })}
            onSaveMapping={() => run(() => saveSupplierLineMapping(line.id))}
          />
        ))}

        {lines.length === 0 && (
          <div className="card p-6 text-center text-gray-400">
            Geen regels herkend uit dit bestand. Voeg hieronder handmatig regels toe.
          </div>
        )}

        {lines.length > 0 && filteredLines.length === 0 && (
          <div className="card p-6 text-center text-gray-400">{reviewFilterEmptyMessage(filter)}</div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Meerdere regels tegelijk toevoegen (plakken)</h2>
        <p className="text-sm text-gray-500 mb-4">
          Handig als automatisch uitlezen niet lukt (bv. een screenshot zonder OCR) of gewoon sneller dan één voor
          één. Plak per regel: <code className="text-xs bg-gray-100 px-1 rounded">Omschrijving</code> +{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">stelen per doos</code> +{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">FOB-prijs per steel</code> (gescheiden door een Tab of
          komma). Een omschrijving die overeenkomt met de variëteit van dit assortiment wordt automatisch
          gematcht.
        </p>
        <form action={bulkAddOfferLines.bind(null, offerId)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="label">Doostype (standaard)</label>
              <input className="input" name="boxType" defaultValue="QB" />
            </div>
            <div>
              <label className="label">Valuta (standaard)</label>
              <select className="input" name="currency" defaultValue="USD">
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Regels (één per variëteit)</label>
            <textarea
              className="input font-mono text-xs"
              name="rows"
              rows={8}
              required
              placeholder={"White Select 15/16cm\t40\t0.47\nWhite Premium 18/20cm\t30\t0.60\nWhite Jumbo 22+\t20\t1.02"}
            />
          </div>
          <button className="btn-primary" type="submit">
            Regels toevoegen
          </button>
        </form>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Handmatig regel toevoegen</h2>
        <form action={addManualOfferLine.bind(null, offerId)} className="grid grid-cols-4 gap-3">
          <FormField label="Productgroep" name="productGroupRaw" />
          <FormField label="Variëteit" name="varietyRaw" />
          <FormField label="Lengte (cm)" name="stemLengthCm" type="number" />
          <FormField label="Box type" name="boxType" defaultValue="QB" />
          <FormField label="Stelen per doos" name="stemsPerBox" type="number" />
          <FormField label="FOB-prijs per steel" name="fobPricePerStem" type="number" step="0.0001" />
          <FormField label="Doosgewicht (kg)" name="weightPerBoxKg" type="number" step="0.001" />
          <div className="col-span-4">
            <button className="btn-secondary" type="submit">
              + Regel toevoegen
            </button>
          </div>
        </form>
      </div>

      {activeLine && modal?.kind === "match" && (
        <MatchSelectionModal
          line={activeLine}
          farmName={farmName}
          allOptions={allAssortmentOptions}
          isPending={isPending}
          onClose={() => setModal(null)}
          onChoose={(packagingWeightProfileId) =>
            run(
              () => selectPackagingProfile(activeLine.id, packagingWeightProfileId),
              () => setModal(null),
            )
          }
        />
      )}

      {activeLine && modal?.kind === "create" && (
        <CreateAssortmentModal
          line={activeLine}
          farmId={farmId}
          farmName={farmName}
          isPending={isPending}
          onClose={() => setModal(null)}
          onCreate={(formData) =>
            run(
              () => createAssortmentItemFromOfferLine(activeLine.id, formData),
              () => setModal(null),
            )
          }
        />
      )}
    </div>
  );
}

/**
 * Doubles as both the summary counter AND the filter control (section 1D) -
 * clicking a stat activates that filter, so the existing compact summary row
 * never needs a second, duplicate block of UI. The active stat is indicated
 * with a ring + background tint (and `aria-pressed`) rather than a separate
 * legend.
 */
function FilterStat({
  filter,
  label,
  value,
  tone,
  active,
  onSelect,
}: {
  filter: ReviewFilter;
  label: string;
  value: number;
  tone?: "green" | "amber" | "red" | "gray";
  active: ReviewFilter;
  onSelect: (filter: ReviewFilter) => void;
}) {
  const isActive = active === filter;
  const toneClass =
    tone === "green"
      ? "text-green-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "red"
          ? "text-red-700"
          : tone === "gray"
            ? "text-gray-600"
            : "text-gray-900";
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={() => onSelect(filter)}
      className={`text-sm rounded-md px-2 py-1 transition-colors ${
        isActive ? "bg-brand-50 ring-1 ring-brand-500" : "hover:bg-gray-50"
      }`}
    >
      <span className={`text-lg font-semibold ${toneClass}`}>{value}</span>{" "}
      <span className="text-gray-500">{label}</span>
    </button>
  );
}

export function FormField({
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
