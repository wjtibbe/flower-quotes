"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  headerCheckboxState,
  toggleAllSelection,
  toggleOneSelection,
  visibleSelectedIds,
} from "@/lib/bulkSelection";
import type { ActionResult } from "@/lib/actionResult";

export interface DeletableColumn {
  header: string;
  className?: string;
}

export interface DeletableRow {
  id: string;
  /** One cell per column, in order; rendered as-is (Links, badges, etc.). */
  cells: ReactNode[];
}

interface Props {
  columns: DeletableColumn[];
  rows: DeletableRow[];
  emptyMessage: string;
  /** Lower-case noun for the selection bar and confirmations, e.g. "offerte". */
  nounSingular: string;
  nounPlural: string;
  /** Confirmation text shown in the single-row delete dialog. */
  confirmSingleText: string;
  deleteAction: (id: string) => Promise<ActionResult>;
  bulkDeleteAction: (ids: string[]) => Promise<ActionResult>;
}

type Pending = null | { kind: "single"; id: string } | { kind: "bulk" };

/**
 * Generic selectable list with per-row and bulk delete, reusing the same
 * selection helpers, sticky bulk bar, confirm modal and result toast as the
 * Assortiment table. Refresh is a client-side router.refresh() so the current
 * filters and sorting (kept in the URL by the page's own filter form) are
 * preserved and only the list re-fetches - no full page reload.
 */
export default function DeletableTable({
  columns,
  rows,
  emptyMessage,
  nounSingular,
  nounPlural,
  confirmSingleText,
  deleteAction,
  bulkDeleteAction,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<Pending>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const headerRef = useRef<HTMLInputElement>(null);

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const selectedVisible = useMemo(() => visibleSelectedIds(selected, visibleIds), [selected, visibleIds]);
  const headerState = headerCheckboxState(selectedVisible.length, visibleIds.length);

  // Drop any selected id that has left the (re-filtered/refreshed) view, so a
  // stale selection can never be acted on.
  useEffect(() => {
    setSelected((prev) => {
      const set = new Set(visibleIds);
      const next = prev.filter((id) => set.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [visibleIds]);

  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = headerState === "some";
  }, [headerState]);

  function run(action: () => Promise<ActionResult>, clearSelection: boolean) {
    if (isPending) return; // double-submit guard
    startTransition(async () => {
      const res = await action();
      setToast(res);
      setModal(null);
      if (res.ok) {
        if (clearSelection) setSelected([]);
        router.refresh();
      }
    });
  }

  const colSpan = columns.length + 2; // selection checkbox + actions column

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
            {selectedVisible.length} {selectedVisible.length === 1 ? nounSingular : nounPlural} geselecteerd
          </span>
          <button className="btn-secondary py-1 px-3 text-sm" disabled={isPending} onClick={() => setModal({ kind: "bulk" })}>
            Verwijderen
          </button>
          <button
            className="text-sm text-gray-500 hover:underline ml-1"
            disabled={isPending}
            onClick={() => setSelected([])}
          >
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
                  onChange={(e) => setSelected((prev) => toggleAllSelection(prev, visibleIds, e.target.checked))}
                  disabled={visibleIds.length === 0}
                />
              </th>
              {columns.map((c, i) => (
                <th key={i} className={c.className}>
                  {c.header}
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSel = selectedVisible.includes(row.id);
              return (
                <tr key={row.id} className={isSel ? "bg-brand-50/50" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label="Rij selecteren"
                      checked={isSel}
                      onChange={(e) => setSelected((prev) => toggleOneSelection(prev, row.id, e.target.checked))}
                    />
                  </td>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={columns[i]?.className}>
                      {cell}
                    </td>
                  ))}
                  <td className="whitespace-nowrap text-right">
                    <button
                      className="text-xs text-red-600 hover:underline"
                      disabled={isPending}
                      onClick={() => setModal({ kind: "single", id: row.id })}
                    >
                      Verwijderen
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="text-center text-gray-400 py-6">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal?.kind === "single" && (
        <Modal title={`${cap(nounSingular)} verwijderen`} onClose={() => setModal(null)}>
          <p className="text-sm text-gray-700">{confirmSingleText}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setModal(null)} disabled={isPending}>
              Annuleren
            </button>
            <button
              className="btn-primary"
              disabled={isPending}
              onClick={() => run(() => deleteAction(modal.id), false)}
            >
              {isPending ? "Bezig..." : "Verwijderen"}
            </button>
          </div>
        </Modal>
      )}

      {modal?.kind === "bulk" && (
        <Modal title={`${nounPlural} verwijderen`} onClose={() => setModal(null)}>
          <p className="text-sm text-gray-700">
            Weet je zeker dat je <strong>{selectedVisible.length}</strong>{" "}
            {selectedVisible.length === 1 ? nounSingular : nounPlural} wilt verwijderen? Deze actie kan
            <strong> niet ongedaan </strong> worden gemaakt.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setModal(null)} disabled={isPending}>
              Annuleren
            </button>
            <button
              className="btn-primary"
              disabled={isPending}
              onClick={() => run(() => bulkDeleteAction(selectedVisible), true)}
            >
              {isPending ? "Bezig..." : "Verwijderen"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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
