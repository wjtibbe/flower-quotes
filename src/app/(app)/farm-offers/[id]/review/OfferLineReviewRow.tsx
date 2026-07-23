"use client";

import { useState } from "react";
import type { AssortmentMatchOption } from "@/lib/import/matching/assortmentMatch";
import type { OfferLineViewModel } from "./ReviewOfferClient";
import { FormField } from "./ReviewOfferClient";

const STATUS_LABELS: Record<string, string> = {
  AUTO_MATCHED: "Auto matched",
  DERIVED: "Matched — product derived",
  AMBIGUOUS: "Multiple matches",
  UNMATCHED: "No match",
  USER_LINKED: "Manually matched",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  AUTO_MATCHED: "badge-auto-matched",
  DERIVED: "badge-derived",
  AMBIGUOUS: "badge-ambiguous",
  UNMATCHED: "badge-unmatched",
  USER_LINKED: "badge-user-linked",
};

interface Props {
  line: OfferLineViewModel;
  isPending: boolean;
  onSave: (formData: FormData) => void;
  onDelete: () => void;
  onChooseMatch: () => void;
  onCreateAssortment: () => void;
  onSaveMapping: () => void;
}

export function OfferLineReviewRow({
  line,
  isPending,
  onSave,
  onDelete,
  onChooseMatch,
  onCreateAssortment,
  onSaveMapping,
}: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Pre-fill quantity/unit for display: today's providers only ever populate
  // the legacy boxesAvailable field, never quantity/unit directly - show a
  // sensible starting point (section 3) rather than a blank field, without
  // ever writing this derived guess back until the user actually saves it.
  const effectiveUnit = line.unit ?? (line.boxesAvailable != null ? "BOXES" : "");
  const effectiveQuantity = line.quantity ?? (line.boxesAvailable != null ? String(line.boxesAvailable) : "");

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={STATUS_BADGE_CLASS[line.matchStatus] ?? "badge-unmatched"}>
            {STATUS_LABELS[line.matchStatus] ?? line.matchStatus}
          </span>
          {line.validationErrors.length > 0 && (
            <span className="badge bg-red-600 text-white">
              {line.validationErrors.length} blocking {line.validationErrors.length === 1 ? "error" : "errors"}
            </span>
          )}
          {line.validationWarnings.length > 0 && (
            <span className="badge-medium">
              {line.validationWarnings.length} warning{line.validationWarnings.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <details className="text-xs text-gray-400 max-w-md">
          <summary className="cursor-pointer truncate">Bron: &ldquo;{line.rawText}&rdquo;</summary>
          <p className="mt-1 whitespace-pre-wrap text-gray-500">{line.rawText}</p>
        </details>
      </div>

      {(line.validationErrors.length > 0 || line.validationWarnings.length > 0) && (
        <div className="mb-3 space-y-1">
          {line.validationErrors.map((message, i) => (
            <p key={`err-${i}`} className="text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              {message}
            </p>
          ))}
          {line.validationWarnings.map((message, i) => (
            <p key={`warn-${i}`} className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
              {message}
            </p>
          ))}
        </div>
      )}

      <MatchSection
        line={line}
        onChooseMatch={onChooseMatch}
        onCreateAssortment={onCreateAssortment}
        onSaveMapping={onSaveMapping}
      />

      <form
        className="grid grid-cols-4 gap-3 mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(new FormData(e.currentTarget));
        }}
      >
        <FormField label="Product" name="productGroupRaw" defaultValue={line.productGroupRaw ?? ""} />
        <FormField label="Variety" name="varietyRaw" defaultValue={line.varietyRaw ?? ""} />
        <FormField label="Length (cm)" name="stemLengthCm" type="number" defaultValue={line.stemLengthCm ?? ""} />
        <div>
          <label className="label">Unit</label>
          <select name="unit" className="input" defaultValue={effectiveUnit}>
            <option value="">—</option>
            <option value="STEMS">Stems</option>
            <option value="BUNCHES">Bunches</option>
            <option value="BOXES">Boxes</option>
            <option value="KILOGRAMS">Kilograms</option>
          </select>
        </div>
        <FormField label="Quantity" name="quantity" type="number" step="0.001" defaultValue={effectiveQuantity} />
        <FormField label="Box type" name="boxType" defaultValue={line.boxType ?? "QB"} />
        <FormField label="Stems per box" name="stemsPerBox" type="number" defaultValue={line.stemsPerBox ?? ""} />
        <FormField
          label="Box weight (kg)"
          name="weightPerBoxKg"
          type="number"
          step="0.001"
          defaultValue={line.weightPerBoxKg ?? ""}
        />
        <FormField
          label="Price per stem"
          name="fobPricePerStem"
          type="number"
          step="0.0001"
          defaultValue={line.fobPricePerStem ?? ""}
        />
        <div>
          <label className="label">Currency</label>
          <select name="currency" className="input" defaultValue={line.currency}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Notes</label>
          <input name="notes" className="input" defaultValue={line.notes ?? ""} />
        </div>
        {line.totalStems !== null && (
          <div className="col-span-1 flex items-end">
            <p className="text-xs text-gray-500">
              Total stems: <span className="font-medium text-gray-700">{line.totalStems}</span>
            </p>
          </div>
        )}

        <div className="col-span-4 hidden">
          {/* colorRaw/gradeRaw/treatmentRaw are preserved unchanged (not shown as primary fields per the new UI, but still round-tripped so a save never blanks them). */}
          <input type="hidden" name="colorRaw" defaultValue={line.colorRaw ?? ""} />
          <input type="hidden" name="gradeRaw" defaultValue={line.gradeRaw ?? ""} />
          <input type="hidden" name="treatmentRaw" defaultValue={line.treatmentRaw ?? "normal"} />
        </div>

        <div className="col-span-4 flex items-center justify-between pt-2 border-t border-gray-100">
          <ExtractedSnapshotDetails line={line} />
          <div className="flex gap-2">
            {confirmingDelete ? (
              <>
                <span className="text-xs text-gray-500 self-center">Regel verwijderen?</span>
                <button
                  type="button"
                  className="text-xs text-red-600 font-medium hover:underline"
                  disabled={isPending}
                  onClick={onDelete}
                >
                  Ja, verwijderen
                </button>
                <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setConfirmingDelete(false)}>
                  Annuleren
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-xs text-red-500 hover:underline"
                onClick={() => setConfirmingDelete(true)}
              >
                Regel verwijderen
              </button>
            )}
            <button type="submit" className="btn-primary py-1.5 px-3 text-sm" disabled={isPending}>
              {isPending ? "Bezig..." : "Opslaan"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function MatchSection({
  line,
  onChooseMatch,
  onCreateAssortment,
  onSaveMapping,
}: {
  line: OfferLineViewModel;
  onChooseMatch: () => void;
  onCreateAssortment: () => void;
  onSaveMapping: () => void;
}) {
  if (line.matchStatus === "AMBIGUOUS") {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 flex items-center justify-between gap-3">
        <p className="text-sm text-amber-800">
          {line.matchOptions.length} mogelijke assortimentartikelen gevonden - kies er één.
        </p>
        <button type="button" className="btn-secondary py-1 px-3 text-sm shrink-0" onClick={onChooseMatch}>
          Choose match
        </button>
      </div>
    );
  }

  if (line.matchStatus === "UNMATCHED") {
    return (
      <div className="rounded-md bg-gray-50 border border-gray-200 p-3 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">No matching assortment item.</p>
        <div className="flex gap-2 shrink-0">
          <button type="button" className="btn-secondary py-1 px-3 text-sm" onClick={onChooseMatch}>
            Choose match
          </button>
          <button type="button" className="btn-primary py-1 px-3 text-sm" onClick={onCreateAssortment}>
            Create assortment item
          </button>
        </div>
      </div>
    );
  }

  // AUTO_MATCHED / DERIVED / USER_LINKED - show the matched article compactly.
  return (
    <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center justify-between gap-3">
      <div>
        <MatchedOptionSummary option={line.matchedOption} />
        {line.matchedViaSupplierMapping && (
          <p className="text-xs text-green-700 mt-0.5">Matched via supplier mapping</p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        {/* Section 7: never checked/applied automatically - a deliberate click every time. */}
        {line.canSaveAsSupplierMapping && (
          <button type="button" className="btn-secondary py-1 px-3 text-sm" onClick={onSaveMapping}>
            Save as supplier mapping
          </button>
        )}
        <button type="button" className="btn-secondary py-1 px-3 text-sm" onClick={onChooseMatch}>
          Change match
        </button>
      </div>
    </div>
  );
}

function MatchedOptionSummary({ option }: { option: AssortmentMatchOption | null }) {
  if (!option) {
    return <p className="text-sm text-green-800">Gekoppeld assortimentartikel kon niet worden geladen.</p>;
  }
  return (
    <div className="text-sm text-green-900">
      <p className="font-medium">
        {option.productName} · {option.variety ?? "—"} · {option.stemLength ?? "—"}
      </p>
      <p className="text-green-700 text-xs">
        {option.boxType} · {option.stemsPerBox} stems · {option.boxWeight} kg
      </p>
    </div>
  );
}

function ExtractedSnapshotDetails({ line }: { line: OfferLineViewModel }) {
  const snapshot = line.extractedSnapshot;
  if (!snapshot) return <span />;

  const currentPrice = line.fobPricePerStem ? `$${line.fobPricePerStem}` : "—";
  const snapshotPrice = snapshot.price ? `$${snapshot.price}` : "—";

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">View original extraction</summary>
      <div className="mt-2 grid grid-cols-2 gap-4 max-w-md bg-gray-50 border border-gray-200 rounded p-3">
        <div>
          <p className="font-medium text-gray-600 mb-1">AI extracted</p>
          <p className="text-gray-700">{String(snapshot.varietyRaw ?? "—")}</p>
          <p className="text-gray-700">{snapshot.lengthCm != null ? `${snapshot.lengthCm} cm` : "—"}</p>
          <p className="text-gray-700">{snapshotPrice}</p>
        </div>
        <div>
          <p className="font-medium text-gray-600 mb-1">Current</p>
          <p className="text-gray-700">{line.varietyRaw ?? "—"}</p>
          <p className="text-gray-700">{line.stemLengthCm != null ? `${line.stemLengthCm} cm` : "—"}</p>
          <p className="text-gray-700">{currentPrice}</p>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        Alleen-lezen auditinformatie van de oorspronkelijke AI-extractie op het moment van import - wordt nooit
        aangepast.
      </p>
    </details>
  );
}
