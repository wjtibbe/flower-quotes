/**
 * Pure helpers for table bulk-selection and bulk-edit. Kept free of React and
 * Prisma so the selection/indeterminate logic and the "only changed fields get
 * written" rule can be unit-tested directly, and reused by both the client
 * table component and the server bulk actions.
 */

export type HeaderCheckboxState = "none" | "some" | "all";

/** The subset of `selected` ids that are actually in the current (filtered) view. */
export function visibleSelectedIds(selected: Iterable<string>, visible: string[]): string[] {
  const set = new Set(selected);
  return visible.filter((id) => set.has(id));
}

/**
 * State of the header "select all" checkbox for the current view:
 * - "all": every visible row is selected (checkbox checked)
 * - "some": only part of the visible rows are selected (checkbox indeterminate)
 * - "none": nothing visible is selected (checkbox unchecked)
 */
export function headerCheckboxState(selectedVisibleCount: number, visibleCount: number): HeaderCheckboxState {
  if (visibleCount === 0 || selectedVisibleCount === 0) return "none";
  if (selectedVisibleCount >= visibleCount) return "all";
  return "some";
}

/** Adds (selectAll) or removes (clear) every currently visible id from the selection. */
export function toggleAllSelection(current: Iterable<string>, visible: string[], selectAll: boolean): string[] {
  const set = new Set(current);
  for (const id of visible) {
    if (selectAll) set.add(id);
    else set.delete(id);
  }
  return [...set];
}

/** Toggles a single id in the selection. */
export function toggleOneSelection(current: Iterable<string>, id: string, selected: boolean): string[] {
  const set = new Set(current);
  if (selected) set.add(id);
  else set.delete(id);
  return [...set];
}

// --- Bulk edit -------------------------------------------------------------

/**
 * Which fields the user chose to change, plus the new value for each. A field
 * is only ever written when its `*Enabled` flag is true; every other field
 * keeps each article's existing value. `stemLength` lives on the central
 * ProductVariant, the rest on the supplier's PackagingWeightProfile.
 */
export interface BulkEditInput {
  lengthEnabled: boolean;
  stemLength: string;
  boxTypeEnabled: boolean;
  boxType: string;
  weightEnabled: boolean;
  weightPerBoxKg: string;
  stemsEnabled: boolean;
  stemsPerBox: string;
  codeEnabled: boolean;
  supplierCode: string;
  notesEnabled: boolean;
  notes: string;
}

export interface BulkProfileUpdate {
  boxType?: string;
  weightPerBoxKg?: string;
  stemsPerBox?: number;
  supplierCode?: string | null;
  notes?: string | null;
}

export interface BulkVariantUpdate {
  stemLength?: string | null;
}

const emptyToNull = (s: string): string | null => {
  const t = s.trim();
  return t === "" ? null : t;
};

/** Builds the PackagingWeightProfile update payload, containing only enabled fields. */
export function buildProfileUpdate(input: BulkEditInput): BulkProfileUpdate {
  const data: BulkProfileUpdate = {};
  if (input.boxTypeEnabled) data.boxType = input.boxType.trim();
  if (input.weightEnabled) data.weightPerBoxKg = input.weightPerBoxKg.trim();
  if (input.stemsEnabled) data.stemsPerBox = parseInt(input.stemsPerBox, 10);
  if (input.codeEnabled) data.supplierCode = emptyToNull(input.supplierCode);
  if (input.notesEnabled) data.notes = emptyToNull(input.notes);
  return data;
}

/** Builds the ProductVariant update payload (length only), when enabled. */
export function buildVariantUpdate(input: BulkEditInput): BulkVariantUpdate {
  const data: BulkVariantUpdate = {};
  if (input.lengthEnabled) data.stemLength = emptyToNull(input.stemLength);
  return data;
}

/** True when at least one field is selected for change. */
export function hasAnyEdit(input: BulkEditInput): boolean {
  return (
    input.lengthEnabled ||
    input.boxTypeEnabled ||
    input.weightEnabled ||
    input.stemsEnabled ||
    input.codeEnabled ||
    input.notesEnabled
  );
}

/** Human-readable list of the changes for the confirm/preview UI. */
export function editSummary(input: BulkEditInput): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (input.lengthEnabled) out.push({ label: "Lengte", value: input.stemLength.trim() || "(leeg)" });
  if (input.boxTypeEnabled) out.push({ label: "Box/verpakking", value: input.boxType.trim() || "(leeg)" });
  if (input.weightEnabled) out.push({ label: "Doosgewicht (kg)", value: input.weightPerBoxKg.trim() || "(leeg)" });
  if (input.stemsEnabled) out.push({ label: "Stelen per doos", value: input.stemsPerBox.trim() || "(leeg)" });
  if (input.codeEnabled) out.push({ label: "Leverancierscode", value: input.supplierCode.trim() || "(leeg)" });
  if (input.notesEnabled) out.push({ label: "Aantekeningen", value: input.notes.trim() || "(leeg)" });
  return out;
}

/** Validates the enabled numeric fields; returns an error message or null. */
export function validateBulkEdit(input: BulkEditInput): string | null {
  if (!hasAnyEdit(input)) return "Kies minstens één veld om te wijzigen.";
  if (input.weightEnabled) {
    const n = Number(input.weightPerBoxKg);
    if (!Number.isFinite(n) || n <= 0) return "Doosgewicht moet groter dan nul zijn.";
  }
  if (input.stemsEnabled) {
    const n = parseInt(input.stemsPerBox, 10);
    if (!Number.isInteger(n) || n <= 0) return "Stelen per doos moet een positief geheel getal zijn.";
  }
  if (input.boxTypeEnabled && input.boxType.trim() === "") return "Box/verpakking mag niet leeg zijn.";
  return null;
}
