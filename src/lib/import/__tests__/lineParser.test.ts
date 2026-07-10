import { describe, expect, it } from "vitest";
import { parseOfferLine } from "../lineParser";
import { segmentOfferLines } from "../segment";

describe("parseOfferLine - GUTI-style unstructured lines", () => {
  it("parses a simple Hydrangea line with a tinted price variant", () => {
    const lines = parseOfferLine("Hyd White select 30QBx40 $0,45 | Tinted $0,60");
    expect(lines).toHaveLength(2);

    const [normal, tinted] = lines;
    expect(normal.productGroupRaw).toBe("Hydrangea");
    expect(normal.gradeRaw).toBe("select");
    expect(normal.boxType).toBe("QB");
    expect(normal.boxesAvailable).toBe(30);
    expect(normal.stemsPerBox).toBe(40);
    expect(normal.fobPricePerStem).toBe("0.45");
    expect(normal.treatmentRaw).toBe("normal");
    expect(normal.currency).toBe("USD");
    expect(normal.confidence).toBe("high");
    expect(normal.needsReview).toBe(false);

    expect(tinted.treatmentRaw).toBe("tinted");
    expect(tinted.fobPricePerStem).toBe("0.60");
    expect(tinted.boxesAvailable).toBe(30);
    expect(tinted.stemsPerBox).toBe(40);
  });

  it("parses qb* and qbx spelling variants case-insensitively", () => {
    const a = parseOfferLine("Alstro red angelina fancy 10qb*200 $0,15")[0];
    expect(a.boxesAvailable).toBe(10);
    expect(a.stemsPerBox).toBe(200);
    expect(a.gradeRaw).toBe("fancy");
    expect(a.fobPricePerStem).toBe("0.15");

    const b = parseOfferLine("Ruscus 100QBx300 $0,13| tinted $0,26");
    expect(b[0].boxesAvailable).toBe(100);
    expect(b[0].stemsPerBox).toBe(300);
    expect(b[1].fobPricePerStem).toBe("0.26");
  });

  it("extracts extra lead time notes without corrupting other fields", () => {
    const [line] = parseOfferLine(
      "Alstro painted blue fancy 10qb*200 $0,19 (Additional time required 72 HR)",
    );
    expect(line.extraLeadTimeHrs).toBe(72);
    expect(line.fobPricePerStem).toBe("0.19");
    expect(line.boxesAvailable).toBe(10);
    expect(line.stemsPerBox).toBe(200);
    // "painted" here is part of the variety name, not a treatment - must stay "normal".
    expect(line.treatmentRaw).toBe("normal");
  });

  it("handles single-box-type lines without a treatment variant", () => {
    const [line] = parseOfferLine("Hyd White jumbo 20QBx15 $1,20");
    expect(line.gradeRaw).toBe("jumbo");
    expect(line.fobPricePerStem).toBe("1.20");
    expect(line.stemsPerBox).toBe(15);
  });

  it("flags low confidence and needsReview when price is missing", () => {
    const [line] = parseOfferLine("Hyd White select 30QBx40");
    expect(line.fobPricePerStem).toBeUndefined();
    expect(line.confidence).toBe("low");
    expect(line.needsReview).toBe(true);
    expect(line.parserWarnings.length).toBeGreaterThan(0);
  });

  it("flags medium confidence for an unrecognized product group, but still extracts structured fields", () => {
    const [line] = parseOfferLine("Zzyzx purple deluxe 5QBx50 $0,99");
    expect(line.productGroupRaw).toBe("Zzyzx");
    expect(line.boxesAvailable).toBe(5);
    expect(line.fobPricePerStem).toBe("0.99");
    expect(line.confidence).toBe("medium");
    expect(line.needsReview).toBe(true);
  });

  it("normalizes comma decimal separators", () => {
    const [line] = parseOfferLine("Eryngium 20QBx100 $0,39| tinted $0,46 (Additional time required 72 HR)");
    expect(line.fobPricePerStem).toBe("0.39");
  });
});

describe("segmentOfferLines - filters email noise from real GUTI-style text", () => {
  const sample = [
    "Willem-Jan van Tilburg",
    "From:",
    "gutimilko.sales@gutimilko.com",
    "Sent:",
    "08 July 2026 08:10",
    "To:",
    "gutimilko.sales@gutimilko.com",
    "Subject:",
    "Secure your Weeks 28-31 inventory with our mid-summer promo!",
    "Hi; I hope your week is off to a great start!",
    "Following up on my message from yesterday, I wanted to let you know that our mid summer shipping slots are",
    "filling up fast.",
    "Our farm team is currently packing and ready to dispatch.",
    "",
    "Hyd White select 30QBx40 $0,45 | Tinted $0,60",
    "Hyd White prem 100qbx30 $0,55 | Tinted $0,70",
    "Hyd White jumbo 20QBx15 $1,20",
    "",
    "Ruscus 100QBx300 $0,13| tinted $0,26",
    "Let me know how many boxes you need, and we'll secure the logistics for you right away!",
  ].join("\n");

  it("keeps only product lines", () => {
    const lines = segmentOfferLines(sample);
    expect(lines).toEqual([
      "Hyd White select 30QBx40 $0,45 | Tinted $0,60",
      "Hyd White prem 100qbx30 $0,55 | Tinted $0,70",
      "Hyd White jumbo 20QBx15 $1,20",
      "Ruscus 100QBx300 $0,13| tinted $0,26",
    ]);
  });
});
