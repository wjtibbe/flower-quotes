"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  headerCheckboxState,
  toggleAllSelection,
  toggleOneSelection,
  visibleSelectedIds,
} from "@/lib/bulkSelection";
import { lineStatusBadgeClass, type LineStatusLabel } from "@/lib/farmOfferLineStatus";

export interface FarmOfferDetailLineViewModel {
  id: string;
  productLabel: string;
  isUnmatched: boolean;
  treatment: string | null;
  boxType: string | null;
  boxesAvailable: number | null;
  stemsPerBox: number | null;
  fobPricePerStem: string | null;
  currency: string;
  weightPerBoxKg: string | null;
  statusLabel: LineStatusLabel;
  /** Original AI extraction confidence, kept available (title tooltip) but no longer the headline badge - see farmOfferLineStatus.ts. */
  originalConfidence: string;
  /** `isFarmOfferLineQuotable` result (lib/quotes/lineGating.ts) - the SAME gate `/quotes/new` itself enforces, so select-all can never pre-select a row the wizard would reject anyway. */
  quotable: boolean;
}

/**
 * Task 2 (select all): a master header checkbox that selects/deselects every
 * currently QUOTABLE line at once. Reuses the same pure selection helpers
 * (`@/lib/bulkSelection`) already used by the Assortiment bulk table, so the
 * indeterminate/all/none logic is shared and already tested. Submission
 * stays a plain native GET form to `/quotes/new` (unchanged) - React only
 * controls each checkbox's `checked` state here, so no submit handler is
 * needed and a manipulated/ineligible id can never reach the query string
 * (an ineligible checkbox is `disabled`, so the browser never includes it).
 */
/** The ids "select all" is allowed to touch - never an ineligible/non-quotable line, however it got that way. Extracted as a pure function so it's testable without rendering. */
export function selectableLineIds(lines: FarmOfferDetailLineViewModel[]): string[] {
  return lines.filter((l) => l.quotable).map((l) => l.id);
}

export function FarmOfferLinesTable({ lines }: { lines: FarmOfferDetailLineViewModel[] }) {
  const quotableIds = useMemo(() => selectableLineIds(lines), [lines]);
  const [selected, setSelected] = useState<string[]>([]);
  const headerRef = useRef<HTMLInputElement>(null);

  const selectedVisible = useMemo(() => visibleSelectedIds(selected, quotableIds), [selected, quotableIds]);
  const headerState = headerCheckboxState(selectedVisible.length, quotableIds.length);

  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = headerState === "some";
  }, [headerState]);

  function toggleAll(checked: boolean) {
    setSelected((prev) => toggleAllSelection(prev, quotableIds, checked));
  }
  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => toggleOneSelection(prev, id, checked));
  }

  return (
    <form action="/quotes/new" method="GET" className="card overflow-x-auto p-0">
      <table className="table-base">
        <thead>
          <tr>
            <th className="w-8">
              <input
                ref={headerRef}
                type="checkbox"
                aria-label="Alle offreerbare regels selecteren"
                checked={headerState === "all"}
                onChange={(e) => toggleAll(e.target.checked)}
                disabled={quotableIds.length === 0}
              />
            </th>
            <th>Product</th>
            <th>Box</th>
            <th>Beschikbaar</th>
            <th>Stelen/doos</th>
            <th>FOB</th>
            <th>Gewicht/doos</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>
                <input
                  type="checkbox"
                  name="lineIds"
                  value={line.id}
                  aria-label={`Selecteer ${line.productLabel}`}
                  checked={selected.includes(line.id)}
                  disabled={!line.quotable}
                  title={!line.quotable ? "Deze regel is nog niet offreerbaar (geen bevestigde koppeling)." : undefined}
                  onChange={(e) => toggleOne(line.id, e.target.checked)}
                />
              </td>
              <td>
                {line.isUnmatched ? (
                  <span className="text-amber-600">{line.productLabel} (niet gekoppeld)</span>
                ) : (
                  line.productLabel
                )}
                {line.treatment && line.treatment !== "normal" && (
                  <span className="ml-1 text-xs text-gray-400">({line.treatment})</span>
                )}
              </td>
              <td>{line.boxType ?? "-"}</td>
              <td>{line.boxesAvailable ?? "-"}</td>
              <td>{line.stemsPerBox ?? "-"}</td>
              <td>
                {line.fobPricePerStem ? `${line.currency} ${line.fobPricePerStem}` : (
                  <span className="text-red-500">ontbreekt</span>
                )}
              </td>
              <td>{line.weightPerBoxKg ? `${line.weightPerBoxKg} kg` : <span className="text-red-500">ontbreekt</span>}</td>
              <td>
                <span
                  className={`badge ${lineStatusBadgeClass(line.statusLabel)}`}
                  title={`Oorspronkelijke AI-inschatting bij import: ${line.originalConfidence}`}
                >
                  {line.statusLabel}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="p-4 border-t border-gray-100">
        <button type="submit" className="btn-primary" disabled={selectedVisible.length === 0}>
          Offerte maken van geselecteerde regels
        </button>
      </div>
    </form>
  );
}
