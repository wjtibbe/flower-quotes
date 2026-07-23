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

  const summary = useMemo(() => {
    let ready = 0;
    let warnings = 0;
    let blocking = 0;
    let unmatched = 0;
    for (const line of lines) {
      if (line.validationErrors.length > 0) {
        blocking++;
      } else {
        ready++;
        if (line.validationWarnings.length > 0) warnings++;
      }
      if (line.matchStatus === "UNMATCHED") unmatched++;
    }
    return { total: lines.length, ready, warnings, blocking, unmatched };
  }, [lines]);

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

      <div className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-3 sticky top-2 z-10 shadow-md">
        <SummaryStat label="Total lines" value={summary.total} />
        <SummaryStat label="Ready" value={summary.ready} tone="green" />
        <SummaryStat label="Warnings" value={summary.warnings} tone="amber" />
        <SummaryStat label="Blocking errors" value={summary.blocking} tone="red" />
        <SummaryStat label="Unmatched" value={summary.unmatched} tone="gray" />
        <div className="flex-1" />
        {offerStatus === "REVIEWED" ? (
          <span className="badge badge-auto-matched">Reviewed</span>
        ) : (
          <button
            className="btn-primary"
            disabled={isPending || summary.blocking > 0 || lines.length === 0}
            title={summary.blocking > 0 ? "Los eerst alle blokkerende fouten op" : undefined}
            onClick={() => run(() => confirmFarmOffer(offerId))}
          >
            Confirm offer
          </button>
        )}
      </div>

      <div className="space-y-4">
        {lines.map((line) => (
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

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" | "gray" }) {
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
    <div className="text-sm">
      <span className={`text-lg font-semibold ${toneClass}`}>{value}</span>{" "}
      <span className="text-gray-500">{label}</span>
    </div>
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
