"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtMoney } from "@/lib/format";
import {
  headerCheckboxState,
  toggleAllSelection,
  toggleOneSelection,
  visibleSelectedIds,
  editSummary,
  validateBulkEdit,
  type BulkEditInput,
} from "@/lib/bulkSelection";
import {
  updateSupplierLink,
  duplicateSupplierLink,
  toggleSupplierLinkActive,
  bulkUpdateSupplierLinks,
  bulkDuplicateSupplierLinks,
  bulkDeactivateSupplierLinks,
} from "./actions";

export interface AssortmentRow {
  id: string;
  active: boolean;
  farmId: string;
  farmName: string;
  supplierCode: string | null;
  productName: string;
  color: string | null;
  grade: string | null;
  variety: string | null;
  stemLength: string | null;
  boxType: string;
  stemsPerBox: number;
  weightPerBoxKg: string;
  notes: string | null;
}

interface FarmOption {
  id: string;
  name: string;
}

const emptyEdit: BulkEditInput = {
  lengthEnabled: false,
  stemLength: "",
  boxTypeEnabled: false,
  boxType: "",
  weightEnabled: false,
  weightPerBoxKg: "",
  stemsEnabled: false,
  stemsPerBox: "",
  codeEnabled: false,
  supplierCode: "",
  notesEnabled: false,
  notes: "",
  statusEnabled: false,
  active: true,
};

type Modal = null | "edit" | "duplicate" | "deactivate";

export default function AssortmentTable({ rows, farms }: { rows: AssortmentRow[]; farms: FarmOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [edit, setEdit] = useState<BulkEditInput>(emptyEdit);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const headerRef = useRef<HTMLInputElement>(null);

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const selectedVisible = useMemo(() => visibleSelectedIds(selected, visibleIds), [selected, visibleIds]);
  const headerState = headerCheckboxState(selectedVisible.length, visibleIds.length);

  // Prune any selected ids that are no longer in the (re-filtered) view, so a
  // stale selection can never be acted on after the filters change.
  useEffect(() => {
    setSelected((prev) => {
      const set = new Set(visibleIds);
      const next = prev.filter((id) => set.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [visibleIds]);

  // Native indeterminate can only be set imperatively.
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = headerState === "some";
  }, [headerState]);

  function toggleAll(checked: boolean) {
    setSelected((prev) => toggleAllSelection(prev, visibleIds, checked));
  }
  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => toggleOneSelection(prev, id, checked));
  }
  function clearSelection() {
    setSelected([]);
  }

  function runBulk(action: () => Promise<{ ok: boolean; message: string }>) {
    if (isPending) return; // guard against double submit
    startTransition(async () => {
      const res = await action();
      setToast(res);
      setModal(null);
      if (res.ok) {
        setSelected([]);
        setEdit(emptyEdit);
        router.refresh();
      }
    });
  }

  const editError = modal === "edit" ? validateBulkEdit(edit) : null;
  const summary = editSummary(edit);

  return (
    <div className="space-y-3">
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

      {selectedVisible.length > 0 && (
        <div className="card p-3 bg-brand-50 border-brand-200 flex flex-wrap items-center gap-2 sticky top-0 z-10">
          <span className="text-sm font-medium text-brand-900 mr-1">
            {selectedVisible.length} {selectedVisible.length === 1 ? "artikel" : "artikelen"} geselecteerd
          </span>
          <button
            className="btn-secondary py-1 px-3 text-sm"
            disabled={isPending}
            onClick={() => {
              setEdit(emptyEdit);
              setModal("edit");
            }}
          >
            Bewerken
          </button>
          <button className="btn-secondary py-1 px-3 text-sm" disabled={isPending} onClick={() => setModal("duplicate")}>
            Dupliceren
          </button>
          <button className="btn-secondary py-1 px-3 text-sm" disabled={isPending} onClick={() => setModal("deactivate")}>
            Deactiveren
          </button>
          <button className="text-sm text-gray-500 hover:underline ml-1" disabled={isPending} onClick={clearSelection}>
            Selectie wissen
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-8">
                <input
                  ref={headerRef}
                  type="checkbox"
                  aria-label="Alles selecteren"
                  checked={headerState === "all"}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={visibleIds.length === 0}
                />
              </th>
              <th>Leverancier</th>
              <th>Product</th>
              <th>Variety</th>
              <th>Lengte</th>
              <th>Box/verpakking</th>
              <th>Doosgewicht</th>
              <th>Aantekeningen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const isSel = selectedVisible.includes(p.id);
              return (
                <tr key={p.id} className={`${p.active ? "" : "opacity-50"} ${isSel ? "bg-brand-50/50" : ""}`}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Selecteer ${p.farmName} ${p.productName}`}
                      checked={isSel}
                      onChange={(e) => toggleOne(p.id, e.target.checked)}
                    />
                  </td>
                  <td className="font-medium">
                    {p.farmName}
                    {p.supplierCode && <span className="ml-1 text-xs text-gray-400">({p.supplierCode})</span>}
                  </td>
                  <td>
                    {p.productName}
                    {(p.color || p.grade) && (
                      <span className="text-xs text-gray-400"> {[p.color, p.grade].filter(Boolean).join(" ")}</span>
                    )}
                  </td>
                  <td>{p.variety ?? "-"}</td>
                  <td>{p.stemLength ?? "-"}</td>
                  <td>
                    {p.boxType} <span className="text-xs text-gray-400">({p.stemsPerBox} st)</span>
                  </td>
                  <td>{fmtMoney(p.weightPerBoxKg, 3)} kg</td>
                  <td className="max-w-48 truncate" title={p.notes ?? ""}>
                    {p.notes ?? "-"}
                  </td>
                  <td className="whitespace-nowrap">
                    <details className="inline-block mr-3">
                      <summary className="text-xs text-brand-600 cursor-pointer inline">Bewerken</summary>
                      <form
                        action={updateSupplierLink.bind(null, p.id)}
                        className="mt-2 flex flex-wrap gap-2 items-end bg-gray-50 p-2 rounded"
                      >
                        <div>
                          <label className="label">Leverancier</label>
                          <select name="farmId" defaultValue={p.farmId} className="input py-1 text-xs">
                            {farms.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">Code</label>
                          <input name="supplierCode" defaultValue={p.supplierCode ?? ""} className="input py-1 text-xs w-24" />
                        </div>
                        <div>
                          <label className="label">Box</label>
                          <input name="boxType" defaultValue={p.boxType} className="input py-1 text-xs w-16" />
                        </div>
                        <div>
                          <label className="label">Stelen/doos</label>
                          <input name="stemsPerBox" type="number" required defaultValue={p.stemsPerBox} className="input py-1 text-xs w-20" />
                        </div>
                        <div>
                          <label className="label">Gewicht (kg)</label>
                          <input
                            name="weightPerBoxKg"
                            type="number"
                            step="0.001"
                            required
                            defaultValue={p.weightPerBoxKg}
                            className="input py-1 text-xs w-24"
                          />
                        </div>
                        <div>
                          <label className="label">Aantekeningen</label>
                          <input name="notes" defaultValue={p.notes ?? ""} className="input py-1 text-xs w-40" />
                        </div>
                        <button className="btn-primary py-1 px-2 text-xs">Opslaan</button>
                      </form>
                    </details>
                    <details className="inline-block mr-3">
                      <summary className="text-xs text-brand-600 cursor-pointer inline">Dupliceren</summary>
                      <form
                        action={duplicateSupplierLink.bind(null, p.id)}
                        className="mt-2 flex gap-2 items-end bg-gray-50 p-2 rounded"
                      >
                        <div>
                          <label className="label">Naar leverancier</label>
                          <select name="farmId" className="input py-1 text-xs" defaultValue="">
                            <option value="" disabled>
                              Kies leverancier...
                            </option>
                            {farms.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button className="btn-secondary py-1 px-2 text-xs">Kopie maken</button>
                      </form>
                    </details>
                    <form action={toggleSupplierLinkActive.bind(null, p.id, p.active)} className="inline">
                      <button className="text-xs text-gray-500 hover:underline">
                        {p.active ? "Deactiveren" : "Activeren"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-gray-400 py-6">
                  Geen leverancierskoppelingen gevonden met deze filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- Bulk edit modal --- */}
      {modal === "edit" && (
        <Modal title={`${selectedVisible.length} artikel(en) bewerken`} onClose={() => setModal(null)}>
          <p className="text-sm text-gray-500 mb-4">
            Vink aan welke velden je wilt wijzigen. Alleen aangevinkte velden worden aangepast; alle andere gegevens
            blijven per artikel ongewijzigd.
          </p>
          <div className="space-y-3">
            <EditField
              label="Lengte aanpassen"
              enabled={edit.lengthEnabled}
              onToggle={(v) => setEdit((e) => ({ ...e, lengthEnabled: v }))}
            >
              <input
                className="input py-1 text-sm"
                placeholder="bv. 60 cm"
                value={edit.stemLength}
                onChange={(e) => setEdit((s) => ({ ...s, stemLength: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">
                Lengte hoort bij het centrale product; wijzigen geldt voor alle leverancierskoppelingen van die
                variëteit.
              </p>
            </EditField>
            <EditField
              label="Box/verpakking aanpassen"
              enabled={edit.boxTypeEnabled}
              onToggle={(v) => setEdit((e) => ({ ...e, boxTypeEnabled: v }))}
            >
              <input
                className="input py-1 text-sm"
                placeholder="bv. QB"
                value={edit.boxType}
                onChange={(e) => setEdit((s) => ({ ...s, boxType: e.target.value }))}
              />
            </EditField>
            <EditField
              label="Doosgewicht aanpassen"
              enabled={edit.weightEnabled}
              onToggle={(v) => setEdit((e) => ({ ...e, weightEnabled: v }))}
            >
              <input
                className="input py-1 text-sm"
                type="number"
                step="0.001"
                placeholder="kg"
                value={edit.weightPerBoxKg}
                onChange={(e) => setEdit((s) => ({ ...s, weightPerBoxKg: e.target.value }))}
              />
            </EditField>
            <EditField
              label="Stelen per doos aanpassen"
              enabled={edit.stemsEnabled}
              onToggle={(v) => setEdit((e) => ({ ...e, stemsEnabled: v }))}
            >
              <input
                className="input py-1 text-sm"
                type="number"
                placeholder="aantal"
                value={edit.stemsPerBox}
                onChange={(e) => setEdit((s) => ({ ...s, stemsPerBox: e.target.value }))}
              />
            </EditField>
            <EditField
              label="Leverancierscode aanpassen"
              enabled={edit.codeEnabled}
              onToggle={(v) => setEdit((e) => ({ ...e, codeEnabled: v }))}
            >
              <input
                className="input py-1 text-sm"
                value={edit.supplierCode}
                onChange={(e) => setEdit((s) => ({ ...s, supplierCode: e.target.value }))}
              />
            </EditField>
            <EditField
              label="Aantekeningen aanpassen"
              enabled={edit.notesEnabled}
              onToggle={(v) => setEdit((e) => ({ ...e, notesEnabled: v }))}
            >
              <input
                className="input py-1 text-sm"
                value={edit.notes}
                onChange={(e) => setEdit((s) => ({ ...s, notes: e.target.value }))}
              />
            </EditField>
            <EditField
              label="Status aanpassen"
              enabled={edit.statusEnabled}
              onToggle={(v) => setEdit((e) => ({ ...e, statusEnabled: v }))}
            >
              <select
                className="input py-1 text-sm"
                value={edit.active ? "active" : "inactive"}
                onChange={(e) => setEdit((s) => ({ ...s, active: e.target.value === "active" }))}
              >
                <option value="active">Actief</option>
                <option value="inactive">Inactief</option>
              </select>
            </EditField>
          </div>

          {summary.length > 0 && (
            <div className="mt-4 rounded bg-gray-50 p-3 text-sm">
              <div className="font-medium text-gray-800 mb-1">
                {selectedVisible.length} artikel(en) worden aangepast:
              </div>
              <ul className="text-gray-600 space-y-0.5">
                {summary.map((s) => (
                  <li key={s.label}>
                    <span className="text-gray-500">{s.label}:</span> <span className="font-medium">{s.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {editError && <p className="text-sm text-red-600 mt-3">{editError}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setModal(null)} disabled={isPending}>
              Annuleren
            </button>
            <button
              className="btn-primary"
              disabled={isPending || !!editError}
              onClick={() => runBulk(() => bulkUpdateSupplierLinks(selectedVisible, edit))}
            >
              {isPending ? "Bezig..." : "Wijzigingen opslaan"}
            </button>
          </div>
        </Modal>
      )}

      {/* --- Bulk duplicate modal --- */}
      {modal === "duplicate" && (
        <Modal title="Artikelen dupliceren" onClose={() => setModal(null)}>
          <p className="text-sm text-gray-700">
            Weet je zeker dat je <strong>{selectedVisible.length}</strong> artikel(en) wilt dupliceren? Er wordt van elk
            een nieuwe, losse kopie gemaakt.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setModal(null)} disabled={isPending}>
              Annuleren
            </button>
            <button
              className="btn-primary"
              disabled={isPending}
              onClick={() => runBulk(() => bulkDuplicateSupplierLinks(selectedVisible))}
            >
              {isPending ? "Bezig..." : "Dupliceren"}
            </button>
          </div>
        </Modal>
      )}

      {/* --- Bulk deactivate modal --- */}
      {modal === "deactivate" && (
        <Modal title="Artikelen deactiveren" onClose={() => setModal(null)}>
          <p className="text-sm text-gray-700">
            Weet je zeker dat je <strong>{selectedVisible.length}</strong> artikel(en) wilt deactiveren? Deze artikelen
            zijn daarna niet meer actief beschikbaar in het assortiment. Je kunt ze later weer activeren (dit verwijdert
            niets permanent).
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setModal(null)} disabled={isPending}>
              Annuleren
            </button>
            <button
              className="btn-primary"
              disabled={isPending}
              onClick={() => runBulk(() => bulkDeactivateSupplierLinks(selectedVisible))}
            >
              {isPending ? "Bezig..." : "Deactiveren"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EditField({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 items-start">
      <label className="flex items-center gap-2 text-sm text-gray-700 pt-1.5">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {label}
      </label>
      <div className={enabled ? "" : "opacity-40 pointer-events-none"}>{children}</div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
