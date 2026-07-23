"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssortmentMatchOption } from "@/lib/import/matching/assortmentMatch";
import type { ActionResult } from "@/lib/actionResult";
import { updateSupplierLineMappingTarget, deleteSupplierLineMapping } from "./actions";
import { Modal } from "./Modal";

export interface MappingRow {
  id: string;
  farmId: string;
  farmName: string;
  rawSource: string;
  packagingWeightProfileId: string;
  target: {
    productName: string;
    variety: string | null;
    stemLength: string | null;
    boxType: string;
    stemsPerBox: number;
    weightPerBoxKg: string;
  };
  timesUsed: number;
  lastUsedAt: string | null;
  createdByName: string;
  createdAt: string;
  /** This mapping's own farm's assortment, loaded once per distinct farm server-side (never per row/mapping). */
  candidateOptions: AssortmentMatchOption[];
}

type ModalState = null | { kind: "edit"; rowId: string } | { kind: "delete"; rowId: string };

export function MappingsTable({ rows }: { rows: MappingRow[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>) {
    if (isPending) return;
    startTransition(async () => {
      const result = await action();
      setToast(result);
      if (result.ok) {
        setModal(null);
        router.refresh();
      }
    });
  }

  const activeRow = modal ? (rows.find((r) => r.id === modal.rowId) ?? null) : null;

  return (
    <div className="space-y-4">
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

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Source text</th>
              <th>Mapped assortment item</th>
              <th>Times used</th>
              <th>Last used</th>
              <th>Created by</th>
              <th>Created at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="font-medium">{row.farmName}</td>
                <td className="max-w-xs truncate" title={row.rawSource}>
                  {row.rawSource}
                </td>
                <td>
                  <p className="text-sm text-gray-900">
                    {row.target.productName} · {row.target.variety ?? "—"} · {row.target.stemLength ?? "—"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {row.target.boxType} · {row.target.stemsPerBox} stems · {row.target.weightPerBoxKg} kg
                  </p>
                </td>
                <td>{row.timesUsed}</td>
                <td>{row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleDateString("nl-NL") : "—"}</td>
                <td>{row.createdByName}</td>
                <td>{new Date(row.createdAt).toLocaleDateString("nl-NL")}</td>
                <td className="text-right whitespace-nowrap">
                  <button
                    className="text-xs text-brand-700 hover:underline mr-3"
                    onClick={() => setModal({ kind: "edit", rowId: row.id })}
                  >
                    Edit
                  </button>
                  <button
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => setModal({ kind: "delete", rowId: row.id })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-6">
                  Geen supplier mappings gevonden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal?.kind === "edit" && activeRow && (
        <EditTargetModal
          row={activeRow}
          isPending={isPending}
          onClose={() => setModal(null)}
          onChoose={(profileId) => run(() => updateSupplierLineMappingTarget(activeRow.id, profileId))}
        />
      )}

      {modal?.kind === "delete" && activeRow && (
        <Modal title="Mapping verwijderen" onClose={() => setModal(null)}>
          <p className="text-sm text-gray-700">
            Weet je zeker dat je de mapping voor <strong>&ldquo;{activeRow.rawSource}&rdquo;</strong> ({activeRow.farmName}
            ) wilt verwijderen? Dit heeft geen effect op bestaande offerregels of offertes - alleen toekomstige imports
            gebruiken deze mapping niet meer.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setModal(null)} disabled={isPending}>
              Annuleren
            </button>
            <button
              className="btn-primary bg-red-600 hover:bg-red-700"
              disabled={isPending}
              onClick={() => run(() => deleteSupplierLineMapping(activeRow.id))}
            >
              {isPending ? "Bezig..." : "Ja, verwijderen"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EditTargetModal({
  row,
  isPending,
  onClose,
  onChoose,
}: {
  row: MappingRow;
  isPending: boolean;
  onClose: () => void;
  onChoose: (packagingWeightProfileId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return row.candidateOptions;
    return row.candidateOptions.filter((o) =>
      [o.productName, o.variety, o.stemLength, o.boxType].filter(Boolean).some((v) => v!.toLowerCase().includes(q)),
    );
  }, [row.candidateOptions, query]);

  return (
    <Modal title={`Edit mapping target · ${row.farmName}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Bron blijft ongewijzigd: <strong>&ldquo;{row.rawSource}&rdquo;</strong>. Kies hieronder alleen een ander
          assortimentartikel van dezelfde leverancier.
        </p>
        <input
          className="input"
          placeholder="Zoek op product, variëteit, lengte of doostype..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-md">
          {filtered.length === 0 && <p className="p-3 text-sm text-gray-400">Geen assortimentartikelen gevonden.</p>}
          {filtered.map((option) => (
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
              {option.packagingWeightProfileId === row.packagingWeightProfileId && (
                <span className="badge-user-linked shrink-0">huidig</span>
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
