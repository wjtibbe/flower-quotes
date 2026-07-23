"use client";

import { useMemo, useState } from "react";
import type { AssortmentMatchOption } from "@/lib/import/matching/assortmentMatch";
import type { OfferLineViewModel } from "./ReviewOfferClient";
import { Modal } from "./Modal";

interface Props {
  line: OfferLineViewModel;
  farmName: string | null;
  /** The full assortment for this farm - used for the free-text filter (section 9: "eenvoudige case-insensitive client filter", not a fuzzy search engine). */
  allOptions: AssortmentMatchOption[];
  isPending: boolean;
  onClose: () => void;
  onChoose: (packagingWeightProfileId: string) => void;
}

/**
 * "Choose match" (AMBIGUOUS) / "Change match" (any status) flow, sections
 * 8-9: shows the engine's own suggested candidates for this line first, then
 * lets the user search the whole supplier assortment with a simple
 * case-insensitive filter. The actual selection is always re-validated
 * server-side (`selectPackagingProfile` -> `validatePackagingWeightProfileSelection`)
 * - this modal only ever sends a `packagingWeightProfileId`, never trusts its
 * own copy of the option as authoritative.
 */
export function MatchSelectionModal({ line, farmName, allOptions, isPending, onClose, onChoose }: Props) {
  const [query, setQuery] = useState("");

  const suggestedIds = useMemo(() => new Set(line.matchOptions.map((o) => o.packagingWeightProfileId)), [line.matchOptions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((o) =>
      [o.productName, o.variety, o.stemLength, o.boxType].filter(Boolean).some((v) => v!.toLowerCase().includes(q)),
    );
  }, [allOptions, query]);

  // Suggested options first (deterministic order already, from the engine), then the rest.
  const ordered = [
    ...filtered.filter((o) => suggestedIds.has(o.packagingWeightProfileId)),
    ...filtered.filter((o) => !suggestedIds.has(o.packagingWeightProfileId)),
  ];

  return (
    <Modal title={`Choose match${farmName ? ` · ${farmName}` : ""}`} onClose={onClose}>
      <div className="space-y-3">
        {line.matchOptions.length > 0 && (
          <p className="text-xs text-gray-500">
            {line.matchOptions.length} suggestie(s) op basis van product/variëteit/lengte staan bovenaan.
          </p>
        )}
        <input
          className="input"
          placeholder="Zoek op product, variëteit, lengte of doostype..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-md">
          {ordered.length === 0 && <p className="p-3 text-sm text-gray-400">Geen assortimentartikelen gevonden.</p>}
          {ordered.map((option) => (
            <button
              key={option.packagingWeightProfileId}
              type="button"
              disabled={isPending}
              onClick={() => onChoose(option.packagingWeightProfileId)}
              className="w-full text-left p-3 hover:bg-brand-50 disabled:opacity-50 flex items-center justify-between gap-3"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {option.productName} · {option.variety ?? "—"} · {option.stemLength ?? "—"}
                </p>
                <p className="text-xs text-gray-500">
                  {option.boxType} · {option.stemsPerBox} stems · {option.boxWeight} kg
                </p>
              </div>
              {suggestedIds.has(option.packagingWeightProfileId) && (
                <span className="badge-auto-matched shrink-0">suggestie</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button className="btn-secondary" onClick={onClose} disabled={isPending}>
          Annuleren
        </button>
      </div>
    </Modal>
  );
}
