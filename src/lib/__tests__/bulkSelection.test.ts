import { describe, expect, it } from "vitest";
import {
  visibleSelectedIds,
  headerCheckboxState,
  toggleAllSelection,
  toggleOneSelection,
  buildProfileUpdate,
  buildVariantUpdate,
  hasAnyEdit,
  editSummary,
  validateBulkEdit,
  type BulkEditInput,
} from "../bulkSelection";

const noEdit: BulkEditInput = {
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

describe("selection state", () => {
  it("toggles a single id on and off", () => {
    let sel = toggleOneSelection([], "a", true);
    expect(sel).toEqual(["a"]);
    sel = toggleOneSelection(sel, "b", true);
    expect(new Set(sel)).toEqual(new Set(["a", "b"]));
    sel = toggleOneSelection(sel, "a", false);
    expect(sel).toEqual(["b"]);
  });

  it("select-all adds every visible id; unchecking clears them", () => {
    const visible = ["a", "b", "c"];
    const all = toggleAllSelection([], visible, true);
    expect(new Set(all)).toEqual(new Set(visible));
    const cleared = toggleAllSelection(all, visible, false);
    expect(cleared).toEqual([]);
  });

  it("header checkbox is 'all' when every visible row is selected", () => {
    expect(headerCheckboxState(3, 3)).toBe("all");
  });

  it("header checkbox is 'some' (indeterminate) when only part is selected", () => {
    expect(headerCheckboxState(1, 3)).toBe("some");
    expect(headerCheckboxState(2, 3)).toBe("some");
  });

  it("header checkbox is 'none' when nothing (or no rows) selected", () => {
    expect(headerCheckboxState(0, 3)).toBe("none");
    expect(headerCheckboxState(0, 0)).toBe("none");
  });

  it("only counts/acts on selected ids that are still in the filtered view", () => {
    // 'x' was selected but is now filtered out; only 'a' remains visible+selected
    const selected = ["a", "x"];
    const visible = ["a", "b", "c"];
    const vis = visibleSelectedIds(selected, visible);
    expect(vis).toEqual(["a"]);
    // header reflects the visible-only count, so it shows 'some', not 'all'
    expect(headerCheckboxState(vis.length, visible.length)).toBe("some");
  });

  it("select-all within a filter selects only the filtered ids, leaving prior selection intact", () => {
    // 'z' selected from a previous (now hidden) filter; select-all over the
    // current view of [a,b] must add a,b but never touch hidden rows.
    const prior = ["z"];
    const visible = ["a", "b"];
    const after = toggleAllSelection(prior, visible, true);
    expect(new Set(after)).toEqual(new Set(["z", "a", "b"]));
    // acting only uses the visible intersection
    expect(new Set(visibleSelectedIds(after, visible))).toEqual(new Set(["a", "b"]));
  });
});

describe("bulk edit payload", () => {
  it("only the length field is changed when only length is enabled", () => {
    const input: BulkEditInput = { ...noEdit, lengthEnabled: true, stemLength: "60 cm" };
    expect(buildVariantUpdate(input)).toEqual({ stemLength: "60 cm" });
    // no profile fields touched -> every other article value is preserved
    expect(buildProfileUpdate(input)).toEqual({});
  });

  it("non-enabled fields never appear in the update payload", () => {
    const input: BulkEditInput = {
      ...noEdit,
      boxTypeEnabled: true,
      boxType: "HB",
      // these have values typed but are NOT enabled -> must be ignored
      weightPerBoxKg: "9.9",
      notes: "should not be written",
    };
    const profile = buildProfileUpdate(input);
    expect(profile).toEqual({ boxType: "HB" });
    expect(profile).not.toHaveProperty("weightPerBoxKg");
    expect(profile).not.toHaveProperty("notes");
  });

  it("coerces types and empties: stems -> int, empty code/notes -> null", () => {
    const input: BulkEditInput = {
      ...noEdit,
      stemsEnabled: true,
      stemsPerBox: "30",
      codeEnabled: true,
      supplierCode: "  ",
      notesEnabled: true,
      notes: "seizoen 2026",
    };
    expect(buildProfileUpdate(input)).toEqual({
      stemsPerBox: 30,
      supplierCode: null,
      notes: "seizoen 2026",
    });
  });

  it("hasAnyEdit / summary reflect exactly the enabled fields", () => {
    expect(hasAnyEdit(noEdit)).toBe(false);
    const input: BulkEditInput = { ...noEdit, lengthEnabled: true, stemLength: "60 cm", boxTypeEnabled: true, boxType: "HB" };
    expect(hasAnyEdit(input)).toBe(true);
    expect(editSummary(input)).toEqual([
      { label: "Lengte", value: "60 cm" },
      { label: "Box/verpakking", value: "HB" },
    ]);
  });

  it("validation rejects empty selection and bad numbers", () => {
    expect(validateBulkEdit(noEdit)).toMatch(/minstens één veld/);
    expect(validateBulkEdit({ ...noEdit, weightEnabled: true, weightPerBoxKg: "0" })).toMatch(/Doosgewicht/);
    expect(validateBulkEdit({ ...noEdit, stemsEnabled: true, stemsPerBox: "-3" })).toMatch(/Stelen per doos/);
    expect(validateBulkEdit({ ...noEdit, lengthEnabled: true, stemLength: "60 cm" })).toBeNull();
  });
});
