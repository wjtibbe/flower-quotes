"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { variantLabel } from "@/lib/variantLabel";
import {
  searchManualOfferAssortment,
  saveManualOfferLines,
  type ManualOfferAssortmentFilters,
  type ManualOfferLineInput,
} from "../../manualOfferActions";
import type { AssortmentPage, AssortmentProfileRow } from "../../../products/assortmentQuery";

const UNIT_LABELS: Record<string, string> = {
  STEMS: "Aantal stelen",
  BUNCHES: "Aantal bossen",
  BOXES: "Aantal dozen",
  KILOGRAMS: "Beschikbare KG",
};

interface SelectedLine {
  key: string; // packagingWeightProfileId - also the dedupe/error-addressing key
  profile: AssortmentProfileRow;
  quantity: string;
  unit: string;
  fobPricePerStem: string;
  notes: string;
}

interface Props {
  offerId: string;
  farmId: string;
  farmName: string;
  farmDefaultCurrency: string;
}

export function ManualOfferBuilder({ offerId, farmId, farmName, farmDefaultCurrency }: Props) {
  const router = useRouter();

  const [currency, setCurrency] = useState(farmDefaultCurrency);
  const [filters, setFilters] = useState<ManualOfferAssortmentFilters>({});
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<AssortmentPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const justSaved = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    searchManualOfferAssortment(farmId, filters, page)
      .then((resultPage) => {
        if (!cancelled) setResults(resultPage);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId, filters, page]);

  // Unsaved-changes warning: only while there is something to lose and we
  // are not navigating away as a RESULT of a successful save.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (lines.length > 0 && !justSaved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [lines.length]);

  const selectedIds = useMemo(() => new Set(lines.map((l) => l.key)), [lines]);

  function addArticle(profile: AssortmentProfileRow) {
    if (selectedIds.has(profile.id)) return; // no duplicate lines for the same canonical article
    setLines((prev) => [
      ...prev,
      { key: profile.id, profile, quantity: "", unit: "BOXES", fobPricePerStem: "", notes: "" },
    ]);
  }

  function removeArticle(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function updateLine(key: string, patch: Partial<Pick<SelectedLine, "quantity" | "unit" | "fobPricePerStem" | "notes">>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function updateFilter(patch: Partial<ManualOfferAssortmentFilters>) {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  async function handleSave() {
    if (saving) return; // prevent double submission
    if (lines.length === 0) {
      setGlobalError("Voeg minstens één assortimentartikel toe.");
      return;
    }
    setSaving(true);
    setGlobalError(null);
    setLineErrors({});

    const payload: ManualOfferLineInput[] = lines.map((l) => ({
      key: l.key,
      packagingWeightProfileId: l.profile.id,
      quantity: l.quantity,
      unit: l.unit as ManualOfferLineInput["unit"],
      fobPricePerStem: l.fobPricePerStem,
      notes: l.notes || null,
    }));

    const result = await saveManualOfferLines(offerId, currency as never, payload);
    if (result.ok) {
      justSaved.current = true;
      startTransition(() => {
        router.push(`/farm-offers/${result.offerId}/review`);
      });
    } else {
      setGlobalError(result.globalError ?? null);
      setLineErrors(result.lineErrors);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Leverancier</label>
          <div className="text-sm font-medium text-gray-800 py-1.5">{farmName}</div>
        </div>
        <div>
          <label className="label">Valuta voor deze aanbieding</label>
          <select className="input py-1.5" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div className="ml-auto text-sm text-gray-600">
          <span className="font-semibold">{lines.length}</span> artikel{lines.length === 1 ? "" : "en"} geselecteerd
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="font-medium text-gray-700 text-sm">Assortiment zoeken - {farmName}</div>
        <div className="flex flex-wrap gap-2">
          <input
            className="input py-1 px-2 text-xs w-48"
            placeholder="Zoeken (product, variëteit, ...)"
            value={filters.q ?? ""}
            onChange={(e) => updateFilter({ q: e.target.value || undefined })}
          />
          <input
            className="input py-1 px-2 text-xs w-32"
            placeholder="Lengte"
            value={filters.length ?? ""}
            onChange={(e) => updateFilter({ length: e.target.value || undefined })}
          />
          <label className="text-xs text-gray-600 flex items-center gap-1">
            <input
              type="checkbox"
              checked={filters.includeInactive ?? false}
              onChange={(e) => updateFilter({ includeInactive: e.target.checked || undefined })}
            />
            Toon inactieve artikelen
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="table-compact">
            <thead>
              <tr>
                <th>Productgroep</th>
                <th>Variëteit</th>
                <th>Grade</th>
                <th>Lengte</th>
                <th>Verpakking</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(results?.rows ?? []).map((profile) => {
                const added = selectedIds.has(profile.id);
                return (
                  <tr key={profile.id}>
                    <td>{profile.productVariant.product.name}</td>
                    <td>{profile.productVariant.variety ?? "-"}</td>
                    <td>{profile.productVariant.grade ?? "-"}</td>
                    <td>{profile.productVariant.stemLength ?? "-"}</td>
                    <td className="text-gray-500">
                      {profile.boxType} · {profile.stemsPerBox}/doos · {profile.weightPerBoxKg.toString()} kg
                    </td>
                    <td>
                      {added ? (
                        <span className="text-xs text-green-700">Toegevoegd ✓</span>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-brand-600 hover:underline"
                          onClick={() => addArticle(profile)}
                        >
                          + Toevoegen
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {results && results.rows.length === 0 && !searching && (
                <tr>
                  <td colSpan={6} className="text-gray-400">
                    Geen assortimentartikelen gevonden voor deze leverancier.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {results && results.pagination.totalPages > 1 && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <button
              type="button"
              className="btn-secondary py-1 px-2 text-xs"
              disabled={results.pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Vorige
            </button>
            <span>
              Pagina {results.pagination.page} van {results.pagination.totalPages}
            </span>
            <button
              type="button"
              className="btn-secondary py-1 px-2 text-xs"
              disabled={results.pagination.page >= results.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Volgende
            </button>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="font-medium text-gray-700 text-sm">Geselecteerde artikelen</div>
        {globalError && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{globalError}</div>}
        <div className="overflow-x-auto">
          <table className="table-compact">
            <thead>
              <tr>
                <th>Product</th>
                <th>Variëteit</th>
                <th>Eenheid</th>
                <th>Aantal</th>
                <th>Prijs (per steel)</th>
                <th>Notities</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key}>
                  <td>{line.profile.productVariant.product.name}</td>
                  <td>{variantLabel(line.profile.productVariant, line.profile.productVariant.product.name)}</td>
                  <td>
                    <select
                      className="input py-1 px-2 text-xs"
                      value={line.unit}
                      onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                    >
                      {Object.entries(UNIT_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input py-1 px-2 text-xs w-24"
                      type="number"
                      step="0.001"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input py-1 px-2 text-xs w-24"
                      type="number"
                      step="0.0001"
                      value={line.fobPricePerStem}
                      onChange={(e) => updateLine(line.key, { fobPricePerStem: e.target.value })}
                    />{" "}
                    <span className="text-xs text-gray-500">{currency}</span>
                  </td>
                  <td>
                    <input
                      className="input py-1 px-2 text-xs w-32"
                      value={line.notes}
                      onChange={(e) => updateLine(line.key, { notes: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removeArticle(line.key)}>
                      Verwijderen
                    </button>
                    {lineErrors[line.key] && <div className="text-xs text-red-700 mt-0.5">{lineErrors[line.key]}</div>}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-gray-400">
                    Nog geen artikelen geselecteerd.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || lines.length === 0}>
          {saving ? "Opslaan..." : "Aanbieding opslaan"}
        </button>
      </div>
    </div>
  );
}
