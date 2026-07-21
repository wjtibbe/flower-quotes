/**
 * Builds the "cannot delete, still in use" message for a hard delete that is
 * blocked by referential integrity. Pure + tested so every delete action
 * words the block the same way. Returns null when nothing blocks the delete.
 *
 * Example: blockedDeleteMessage("Deze leverancier", [{count: 128, label:
 * "assortimentregel(s)"}]) -> "Deze leverancier kan niet worden verwijderd
 * omdat deze nog wordt gebruikt door 128 assortimentregel(s)."
 */
export function blockedDeleteMessage(
  subject: string,
  blockers: { count: number; label: string }[],
): string | null {
  const active = blockers.filter((b) => b.count > 0);
  if (active.length === 0) return null;
  const parts = active.map((b) => `${b.count} ${b.label}`);
  return `${subject} kan niet worden verwijderd omdat deze nog wordt gebruikt door ${parts.join(", ")}.`;
}
