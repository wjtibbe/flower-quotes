"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtMoney } from "@/lib/format";
import { detectTrailingLengthHint, normalizeAssortmentStemLength } from "@/lib/assortmentLength";
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
  deleteSupplierLink,
  bulkUpdateSupplierLinks,
  bulkDuplicateSupplierLinks,
  bulkDeleteSupplierLinks,
} from "./actions";

export interface AssortmentRow {
  id: string;
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
};

type Modal = null | "edit" | "duplicate" | "delete";

/**
 * The Length input's initial value when a row's inline edit opens: the
 * row's own (already-normalizable) length if it has one, otherwise a
 * deterministic hint parsed off a legacy Variety's trailing "18cm"-style
 * suffix (section 4) - convenience only, never blank-guessed, and NEVER
 * changes Variety itself. Falls back to an empty field for the user to fill
 * in themselves when neither is available/unambiguous.
 */
function initialStemLengthFor(row: AssortmentRow): string {
  if (row.stemLength) {
    const normalized = normalizeAssortmentStemLength(row.stemLength);
    if (normalized.ok) return normalized.value;
  }
  return detectTrailingLengthHint(row.variety) ?? "";
}

export default function AssortmentTable({ rows, farms }: { rows: AssortmentRow[]; farms: FarmOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [edit, setEdit] = useState<BulkEditInput>(emptyEdit);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  // Only one row can be inline-edited at a time (section 6) - opening
  // another row's edit simply replaces this, closing the previous one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
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

  function startEdit(id: string) {
    setEditingId(id);
    setRowError(null);
  }

  function cancelEdit() {
    // No server request, no DB change - just leaves edit mode (section 6).
    setEditingId(null);
    setRowError(null);
  }

  /**
   * Per-row inline "Bewerken" save - reuses the SAME `updateSupplierLink`
   * action from the previous task unchanged (safe ProductVariant re-linking,
   * numeric length normalization, duplicate protection). On success the row
   * returns to normal display with the refreshed values and the current
   * page/search/filter state is preserved (`router.refresh()` re-fetches the
   * SAME URL, it never navigates). On error, edit mode stays open and the
   * message is shown inline next to that row, not as a page-wide toast.
   */
  function runRowEdit(id: string, formData: FormData) {
    if (isPending) return;
    startTransition(async () => {
      const res = await updateSupplierLink(id, formData);
      if (res.ok) {
        setToast(res);
        setRowError(null);
        setEditingId(null);
        router.refresh();
      } else {
        setRowError({ id, message: res.message });
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
          <button className="btn-secondary py-1 px-3 text-sm" disabled={isPending} onClick={() => setModal("delete")}>
            Verwijderen
          </button>
          <button className="text-sm text-gray-500 hover:underline ml-1" disabled={isPending} onClick={clearSelection}>
            Selectie wissen
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-compact">
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
              <th>Lengte (cm)</th>
              <th>Box/verpakking</th>
              <th>Doosgewicht</th>
              <th>Aantekeningen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AssortmentTableRow
                key={row.id}
                row={row}
                farms={farms}
                isSelected={selectedVisible.includes(row.id)}
                isEditing={editingId === row.id}
                isPending={isPending}
                errorMessage={rowError && rowError.id === row.id ? rowError.message : null}
                onToggleSelect={(checked) => toggleOne(row.id, checked)}
                onStartEdit={() => startEdit(row.id)}
                onCancelEdit={cancelEdit}
                onSave={(formData) => runRowEdit(row.id, formData)}
              />
            ))}
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

      {/* --- Bulk delete modal --- */}
      {modal === "delete" && (
        <Modal title="Artikelen verwijderen" onClose={() => setModal(null)}>
          <p className="text-sm text-gray-700">
            Weet je zeker dat je <strong>{selectedVisible.length}</strong> artikel(en) wilt verwijderen? Deze actie kan
            <strong> niet ongedaan </strong> worden gemaakt.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setModal(null)} disabled={isPending}>
              Annuleren
            </button>
            <button
              className="btn-primary"
              disabled={isPending}
              onClick={() => runBulk(() => bulkDeleteSupplierLinks(selectedVisible))}
            >
              {isPending ? "Bezig..." : "Verwijderen"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * One Assortiment overview row - either the compact display cells, or (when
 * `isEditing`) the SAME row with its cells swapped for inline inputs
 * (section 1). Kept as its own component (rather than inline JSX in the
 * `rows.map` above) so its edit-field state is a stable per-row React hook
 * instance - required for the fields to reset correctly on Cancel (see the
 * effect below) without violating the rules of hooks.
 */
function AssortmentTableRow({
  row,
  farms,
  isSelected,
  isEditing,
  isPending,
  errorMessage,
  onToggleSelect,
  onStartEdit,
  onCancelEdit,
  onSave,
}: {
  row: AssortmentRow;
  farms: FarmOption[];
  isSelected: boolean;
  isEditing: boolean;
  isPending: boolean;
  errorMessage: string | null;
  onToggleSelect: (checked: boolean) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (formData: FormData) => void;
}) {
  const [farmId, setFarmId] = useState(row.farmId);
  const [supplierCode, setSupplierCode] = useState(row.supplierCode ?? "");
  const [variety, setVariety] = useState(row.variety ?? "");
  const [stemLength, setStemLength] = useState(() => initialStemLengthFor(row));
  const [boxType, setBoxType] = useState(row.boxType);
  const [stemsPerBox, setStemsPerBox] = useState(String(row.stemsPerBox));
  const [weightPerBoxKg, setWeightPerBoxKg] = useState(row.weightPerBoxKg);
  const [notes, setNotes] = useState(row.notes ?? "");

  // Section 6: Cancel must restore the original/current values - reset every
  // field back to the row's current props whenever edit mode (re)opens, so a
  // previous, cancelled edit never leaks into the next time this row is
  // opened for editing.
  useEffect(() => {
    if (!isEditing) return;
    setFarmId(row.farmId);
    setSupplierCode(row.supplierCode ?? "");
    setVariety(row.variety ?? "");
    setStemLength(initialStemLengthFor(row));
    setBoxType(row.boxType);
    setStemsPerBox(String(row.stemsPerBox));
    setWeightPerBoxKg(row.weightPerBoxKg);
    setNotes(row.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  function handleSave() {
    const formData = new FormData();
    formData.set("farmId", farmId);
    formData.set("supplierCode", supplierCode);
    formData.set("variety", variety);
    formData.set("stemLength", stemLength);
    formData.set("boxType", boxType);
    formData.set("stemsPerBox", stemsPerBox);
    formData.set("weightPerBoxKg", weightPerBoxKg);
    formData.set("notes", notes);
    onSave(formData);
  }

  const checkboxCell = (
    <td>
      <input
        type="checkbox"
        aria-label={`Selecteer ${row.farmName} ${row.productName}`}
        checked={isSelected}
        onChange={(e) => onToggleSelect(e.target.checked)}
      />
    </td>
  );

  if (!isEditing) {
    return (
      <tr className={isSelected ? "bg-brand-50/50" : ""}>
        {checkboxCell}
        <td className="font-medium">
          {row.farmName}
          {row.supplierCode && <span className="ml-1 text-xs text-gray-400">({row.supplierCode})</span>}
        </td>
        <td>
          {row.productName}
          {(row.color || row.grade) && (
            <span className="text-xs text-gray-400"> {[row.color, row.grade].filter(Boolean).join(" ")}</span>
          )}
        </td>
        <td>{row.variety ?? "-"}</td>
        <td>{row.stemLength ?? "-"}</td>
        <td>
          {row.boxType} <span className="text-xs text-gray-400">({row.stemsPerBox} st)</span>
        </td>
        <td>{fmtMoney(row.weightPerBoxKg, 3)} kg</td>
        <td className="max-w-48 truncate" title={row.notes ?? ""}>
          {row.notes ?? "-"}
        </td>
        <td className="whitespace-nowrap">
          <button type="button" className="text-xs text-brand-600 hover:underline mr-2" onClick={onStartEdit}>
            Bewerken
          </button>
          {/* Secondary row actions collapsed behind a compact "..." menu (Task 3B). */}
          <details className="inline-block group">
            <summary className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer inline list-none w-5 text-center">
              <span aria-hidden>⋯</span>
              <span className="sr-only">
                Meer acties voor {row.farmName} {row.productName}
              </span>
            </summary>
            <div className="mt-2 bg-gray-50 p-2 rounded space-y-2 max-w-xs">
              <form action={duplicateSupplierLink.bind(null, row.id)} className="flex gap-2 items-end">
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
                <button className="btn-secondary py-1 px-2 text-xs whitespace-nowrap">Dupliceren</button>
              </form>
              <form action={deleteSupplierLink.bind(null, row.id)}>
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={(e) => {
                    if (
                      !window.confirm(
                        `Weet je zeker dat je "${row.productName} ${row.variety ?? ""}" van ${row.farmName} wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`,
                      )
                    )
                      e.preventDefault();
                  }}
                >
                  Verwijderen
                </button>
              </form>
            </div>
          </details>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-brand-50/40 align-top">
      {checkboxCell}
      <td>
        <select value={farmId} onChange={(e) => setFarmId(e.target.value)} className="input py-1 text-xs w-24">
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <input
          value={supplierCode}
          onChange={(e) => setSupplierCode(e.target.value)}
          placeholder="Code"
          className="input py-1 text-xs w-24 mt-1"
        />
      </td>
      <td className="text-xs text-gray-500 pt-2">{row.productName}</td>
      <td>
        <input
          value={variety}
          onChange={(e) => setVariety(e.target.value)}
          required
          className="input py-1 text-xs w-40"
        />
      </td>
      <td>
        <input
          type="number"
          min={1}
          step={1}
          value={stemLength}
          onChange={(e) => setStemLength(e.target.value)}
          required
          className="input py-1 text-xs w-16"
        />
      </td>
      <td>
        <input
          value={boxType}
          onChange={(e) => setBoxType(e.target.value)}
          placeholder="QB"
          className="input py-1 text-xs w-14"
        />
        <input
          type="number"
          value={stemsPerBox}
          onChange={(e) => setStemsPerBox(e.target.value)}
          required
          placeholder="st"
          className="input py-1 text-xs w-14 mt-1"
        />
      </td>
      <td>
        <input
          type="number"
          step="0.001"
          value={weightPerBoxKg}
          onChange={(e) => setWeightPerBoxKg(e.target.value)}
          required
          className="input py-1 text-xs w-20"
        />
      </td>
      <td>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input py-1 text-xs w-32" />
      </td>
      <td className="whitespace-nowrap">
        <div className="flex gap-2">
          <button type="button" className="btn-primary py-1 px-2 text-xs" disabled={isPending} onClick={handleSave}>
            {isPending ? "Bezig..." : "Opslaan"}
          </button>
          <button type="button" className="text-xs text-gray-500 hover:underline" disabled={isPending} onClick={onCancelEdit}>
            Annuleren
          </button>
        </div>
        {errorMessage && <p className="text-xs text-red-600 mt-1 max-w-[11rem]">{errorMessage}</p>}
      </td>
    </tr>
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
