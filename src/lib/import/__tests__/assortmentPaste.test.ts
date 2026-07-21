import { describe, it, expect } from "vitest";
import {
  isHeaderRow,
  parseAssortmentPasteRow,
  splitArticle,
  normalizeFarmName,
  matchFarm,
} from "@/lib/import/assortmentPaste";

describe("isHeaderRow", () => {
  it("detects the Leverancier header", () => {
    expect(isHeaderRow("Leverancier\tInkoop Artikel\tLengte\tDoos\tStelen per doos\tKG per doos")).toBe(true);
  });
  it("does not flag a data row", () => {
    expect(isHeaderRow("C.I Flores de Aposentos\tDianthus St Brut\t50\tQB\t280\t7.8")).toBe(false);
  });
});

describe("parseAssortmentPasteRow", () => {
  it("parses a full tab-separated row", () => {
    expect(parseAssortmentPasteRow("C.I Flores de Aposentos\tDianthus St Brut\t50\tQB\t280\t7.8")).toEqual({
      supplierName: "C.I Flores de Aposentos",
      article: "Dianthus St Brut",
      stemLength: "50",
      boxType: "QB",
      stemsPerBox: 280,
      weightPerBoxKg: "7.8",
    });
  });

  it("defaults an empty box type to QB", () => {
    const row = parseAssortmentPasteRow("Colibri\tDianthus Sp Athena\t60\t\t260\t7.8");
    expect(row?.boxType).toBe("QB");
  });

  it("rejects rows with too few columns", () => {
    expect(parseAssortmentPasteRow("Colibri\tDianthus Sp Athena\t60")).toBeNull();
  });

  it("rejects non-positive stems per box", () => {
    expect(parseAssortmentPasteRow("Colibri\tDianthus Sp Athena\t60\tQB\t0\t7.8")).toBeNull();
  });

  it("rejects a missing weight", () => {
    expect(parseAssortmentPasteRow("Colibri\tDianthus Sp Athena\t60\tQB\t260\t")).toBeNull();
  });
});

describe("splitArticle", () => {
  it("keeps Dianthus St as its own product", () => {
    expect(splitArticle("Dianthus St Bridal Damascus")).toEqual({
      productName: "Dianthus St",
      variety: "Bridal Damascus",
    });
  });
  it("keeps Dianthus Sp as a separate product", () => {
    expect(splitArticle("Dianthus Sp Athena")).toEqual({ productName: "Dianthus Sp", variety: "Athena" });
  });
  it("handles Solomio and Spray types", () => {
    expect(splitArticle("Dianthus Solomio Blondfly")).toEqual({ productName: "Dianthus Solomio", variety: "Blondfly" });
    expect(splitArticle("Dianthus Spray Sundrop")).toEqual({ productName: "Dianthus Spray", variety: "Sundrop" });
  });
  it("collapses extra whitespace in the article", () => {
    expect(splitArticle("Dianthus St  Bridal Damascus")).toEqual({
      productName: "Dianthus St",
      variety: "Bridal Damascus",
    });
  });
  it("splits a non-Dianthus genus on the first word", () => {
    expect(splitArticle("Inirida Summer")).toEqual({ productName: "Inirida", variety: "Summer" });
  });
  it("returns null when there is no variety", () => {
    expect(splitArticle("Inirida")).toBeNull();
  });
});

describe("normalizeFarmName", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeFarmName("La Gaitana Farms S.A.S.")).toBe("la gaitana farms");
    expect(normalizeFarmName("COLIBRI FLOWERS.S.A")).toBe("colibri flowers");
    expect(normalizeFarmName("C.I. Sunshine Bouquet S.A.S.")).toBe("sunshine bouquet");
  });
});

describe("matchFarm", () => {
  const farms = [
    { id: "1", name: "La Gaitana Farms" },
    { id: "2", name: "Gutimilko" },
    { id: "3", name: "Sunshine Bouquet" },
  ];

  it("matches across a legal-suffix difference", () => {
    expect(matchFarm(farms, "La Gaitana Farms S.A.S.")?.id).toBe("1");
    expect(matchFarm(farms, "C.I. Sunshine Bouquet S.A.S.")?.id).toBe("3");
  });

  it("returns null when nothing resembles the name", () => {
    expect(matchFarm(farms, "LIWI FLOR ETERNA SAS")).toBeNull();
  });
});
