/**
 * Canonical numeric assortment stem length (Assortiment overview + create/
 * edit actions). `ProductVariant.stemLength` is a free-text column at the
 * schema level (see prisma/schema.prisma) - this module is the shared
 * boundary that keeps every value actually WRITTEN through it a plain
 * positive integer string ("60"), never "60 cm"/"60CM"/a range, without
 * introducing a second numeric field. Pure - no Prisma/React, so every create
 * and edit path can funnel through the same rule and it stays independently
 * testable.
 */

export type NormalizeAssortmentLengthResult = { ok: true; value: string } | { ok: false; error: string };

// A whole number, optionally followed by "cm" (any casing, optional space) -
// nothing else. Deliberately rejects decimals ("50.5"), ranges ("40-60"),
// lists ("40/50/60") and any non-numeric text - one profile is one concrete
// length, never a fuzzy/derived guess.
const LENGTH_PATTERN = /^(\d+)\s*(?:cm)?$/i;

const INVALID_MESSAGE = "Lengte moet een geheel getal in cm zijn (bv. 60) - geen bereik, komma of tekst.";

/**
 * Normalizes a free-text stem length ("50", "50cm", "50 cm", "50 CM") to the
 * canonical numeric string form ("50") this app stores/displays everywhere.
 * Rejects (never guesses) anything that isn't a single positive integer:
 * decimals, ranges, slash-separated lists, or non-numeric text.
 */
export function normalizeAssortmentStemLength(input: string): NormalizeAssortmentLengthResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Lengte is verplicht." };

  const match = trimmed.match(LENGTH_PATTERN);
  if (!match) return { ok: false, error: INVALID_MESSAGE };

  const parsed = parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, error: INVALID_MESSAGE };

  return { ok: true, value: String(parsed) };
}

// A single, unambiguous trailing "<number>cm" (any casing, optional space)
// at the very END of a variety string - e.g. "Shiny Copper Premium 18cm".
// Deliberately anchored ($) and requires a preceding whitespace boundary, so
// it never matches a number that's merely somewhere inside a longer variety
// name, and never fires more than once.
const TRAILING_LENGTH_PATTERN = /\s(\d+)\s*cm$/i;

/**
 * Best-effort, deterministic Length prefill for a legacy row whose Variety
 * text still carries an explicit trailing length ("Shiny Copper Premium
 * 18cm") while the row's own Length is empty. Convenience ONLY - never
 * mutates Variety, and returns null for anything not an unambiguous single
 * trailing match (no guessing which number in a longer text might be a
 * length). The caller decides whether/how to use this as a form default.
 */
export function detectTrailingLengthHint(variety: string | null | undefined): string | null {
  if (!variety) return null;
  const match = variety.match(TRAILING_LENGTH_PATTERN);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(parsed);
}
