/**
 * Temporary country -> default departure city rule (interim business rule:
 * suppliers don't yet have their own configurable departure location - see
 * the "IMPORTANT BUSINESS RULE UPDATE" this was added for). A Farm's
 * *country* alone picks a departure among the ALREADY-EXISTING Origin
 * records - Quito for Ecuador, Bogotá for Colombia - matched by city+country
 * once resolved, never guessed at the individual-farm level and never a
 * newly-created/duplicate location.
 *
 * This is the SINGLE central place this mapping lives. Do not scatter
 * "if Ecuador -> Quito" / "if Colombia -> Bogotá" checks through other
 * pricing files - everywhere a default departure is needed should call this
 * (or `resolveDefaultDepartureOrigin` in quotePricing.ts, which resolves the
 * actual Origin row from what this returns). When suppliers get their own
 * configurable departure location later, this is the one place to replace.
 */
export interface DefaultDepartureLocation {
  city: string;
  country: string;
}

const DEFAULT_DEPARTURE_BY_COUNTRY: Record<string, DefaultDepartureLocation> = {
  ecuador: { city: "Quito", country: "Ecuador" },
  colombia: { city: "Bogotá", country: "Colombia" },
};

/**
 * Resolves which existing Origin (city, country) a Farm's country defaults
 * to, or null when the country isn't one of the currently supported ones
 * (Ecuador/Colombia) - callers must treat null as "do not guess" and surface
 * a clear business error instead of picking anything.
 *
 * Matching is case/whitespace-insensitive so it works with however the
 * country happens to be stored ("Ecuador", "ecuador ", "ECUADOR").
 */
export function defaultDepartureLocationForCountry(country: string | null | undefined): DefaultDepartureLocation | null {
  if (!country) return null;
  const key = country.trim().toLowerCase();
  return DEFAULT_DEPARTURE_BY_COUNTRY[key] ?? null;
}
