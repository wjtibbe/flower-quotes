/**
 * The result of a client-driven server action (single or bulk), surfaced by the
 * table components as a success (green) or error (amber) toast. Shared so every
 * delete/update action words its outcome the same way and the client never has
 * to know which action produced it.
 */
export interface ActionResult {
  ok: boolean;
  message: string;
}
