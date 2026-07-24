import { describe, expect, it } from "vitest";
import {
  headerCheckboxState,
  toggleAllSelection,
  toggleOneSelection,
  visibleSelectedIds,
} from "@/lib/bulkSelection";
import { selectableLineIds, type FarmOfferDetailLineViewModel } from "../FarmOfferLinesTable";

function line(overrides: Partial<FarmOfferDetailLineViewModel> & { id: string }): FarmOfferDetailLineViewModel {
  return {
    productLabel: "Dallas 60cm",
    isUnmatched: false,
    treatment: "normal",
    boxType: "QB",
    boxesAvailable: 10,
    stemsPerBox: 100,
    fobPricePerStem: "0,3800",
    currency: "USD",
    weightPerBoxKg: "8,000",
    statusLabel: "Confirmed",
    originalConfidence: "HIGH",
    quotable: true,
    ...overrides,
  };
}

describe("selectableLineIds - eligibility gate for select-all (Task 2)", () => {
  it("excludes an ineligible (non-quotable) line even though it has an id", () => {
    const lines = [line({ id: "a", quotable: true }), line({ id: "b", quotable: false })];
    expect(selectableLineIds(lines)).toEqual(["a"]);
  });

  it("is empty when every line is ineligible", () => {
    const lines = [line({ id: "a", quotable: false }), line({ id: "b", quotable: false })];
    expect(selectableLineIds(lines)).toEqual([]);
  });

  it("includes every line when all are eligible", () => {
    const lines = [line({ id: "a" }), line({ id: "b" }), line({ id: "c" })];
    expect(selectableLineIds(lines)).toEqual(["a", "b", "c"]);
  });
});

describe("select all / deselect all / partial selection, composed with the eligibility gate", () => {
  const lines = [
    line({ id: "a", quotable: true }),
    line({ id: "b", quotable: true }),
    line({ id: "c", quotable: false }), // e.g. UNMATCHED, no confirmed profile
  ];
  const selectable = selectableLineIds(lines); // ["a", "b"]

  // C: select all selects every eligible line.
  it("C: selecting all selects every eligible line and never the ineligible one", () => {
    const selected = toggleAllSelection([], selectable, true);
    expect(new Set(selected)).toEqual(new Set(["a", "b"]));
    expect(selected).not.toContain("c");
  });

  it("C: select-all is a no-op reachable target even if 'c' were somehow pre-selected out of band - visibleSelectedIds ignores it", () => {
    const selected = toggleAllSelection(["c"], selectable, true);
    // toggleAllSelection only ever adds/removes ids from the `visible` (selectable) list -
    // a stray "c" already in `current` is left untouched, but never counted as part of "all selected".
    const visible = visibleSelectedIds(selected, selectable);
    expect(new Set(visible)).toEqual(new Set(["a", "b"]));
  });

  // D: deselect all clears the selection.
  it("D: deselecting all clears every previously selected eligible id", () => {
    const afterSelectAll = toggleAllSelection([], selectable, true);
    const afterDeselectAll = toggleAllSelection(afterSelectAll, selectable, false);
    expect(visibleSelectedIds(afterDeselectAll, selectable)).toEqual([]);
  });

  // E: partial selection behaves correctly - header state reflects "some", and toggling one more reaches "all".
  it("E: header checkbox state is 'none' -> 'some' -> 'all' as rows are picked one at a time", () => {
    let selected: string[] = [];
    expect(headerCheckboxState(visibleSelectedIds(selected, selectable).length, selectable.length)).toBe("none");

    selected = toggleOneSelection(selected, "a", true);
    expect(headerCheckboxState(visibleSelectedIds(selected, selectable).length, selectable.length)).toBe("some");

    selected = toggleOneSelection(selected, "b", true);
    expect(headerCheckboxState(visibleSelectedIds(selected, selectable).length, selectable.length)).toBe("all");
  });

  // F: quote action receives selected IDs only - the form only ever renders a
  // `name="lineIds"` checkbox per line, and only CHECKED (selected) boxes are
  // included by the browser on native GET submission; disabled (ineligible)
  // checkboxes are never checked in the first place (Task 2's rule).
  it("F: the submitted id set is exactly the selected subset, excluding anything not explicitly selected", () => {
    let selected: string[] = [];
    selected = toggleOneSelection(selected, "a", true);
    // "c" was never selectable and is never toggled on.
    const submitted = visibleSelectedIds(selected, selectable);
    expect(submitted).toEqual(["a"]);
    expect(submitted).not.toContain("c");
  });
});
