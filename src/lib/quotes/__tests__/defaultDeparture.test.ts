import { describe, expect, it } from "vitest";
import { defaultDepartureLocationForCountry } from "../defaultDeparture";

describe("defaultDepartureLocationForCountry - central country -> departure rule", () => {
  it("1: an Ecuador supplier defaults to Quito", () => {
    expect(defaultDepartureLocationForCountry("Ecuador")).toEqual({ city: "Quito", country: "Ecuador" });
  });

  it("2: a Colombia supplier defaults to Bogotá", () => {
    expect(defaultDepartureLocationForCountry("Colombia")).toEqual({ city: "Bogotá", country: "Colombia" });
  });

  it("3: Ecuador never resolves to Bogotá", () => {
    expect(defaultDepartureLocationForCountry("Ecuador")?.city).not.toBe("Bogotá");
  });

  it("4: Colombia never resolves to Quito", () => {
    expect(defaultDepartureLocationForCountry("Colombia")?.city).not.toBe("Quito");
  });

  it("5: an unsupported country returns null (never a guess)", () => {
    expect(defaultDepartureLocationForCountry("Kenya")).toBeNull();
    expect(defaultDepartureLocationForCountry(null)).toBeNull();
    expect(defaultDepartureLocationForCountry(undefined)).toBeNull();
    expect(defaultDepartureLocationForCountry("")).toBeNull();
  });

  it("matching is case/whitespace-insensitive - however the country happens to be stored", () => {
    expect(defaultDepartureLocationForCountry("ecuador")).toEqual({ city: "Quito", country: "Ecuador" });
    expect(defaultDepartureLocationForCountry("COLOMBIA")).toEqual({ city: "Bogotá", country: "Colombia" });
    expect(defaultDepartureLocationForCountry("  Ecuador  ")).toEqual({ city: "Quito", country: "Ecuador" });
  });
});
