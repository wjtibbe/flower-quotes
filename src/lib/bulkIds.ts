/**
 * Pure normalization for a list of ids submitted by a bulk action: trims empties,
 * de-duplicates, and enforces a hard ceiling. Kept free of Prisma so it can be
 * unit-tested and reused by every bulk action; the per-model "do these still
 * exist?" check stays in each action since it is model-specific.
 */

// Guard against an accidental "select everything" hitting the database as one
// unbounded write; also a natural double-submit / abuse ceiling.
export const MAX_BULK = 1000;

export function normalizeBulkIds(ids: string[]): { ids: string[] } | { error: string } {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return { error: "Niets geselecteerd." };
  if (unique.length > MAX_BULK) return { error: `Maximaal ${MAX_BULK} records per bulkactie.` };
  return { ids: unique };
}
