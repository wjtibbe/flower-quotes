/**
 * Pure, DB/network-free helpers for the Farm Offer upload progress overlay
 * (UploadForm.tsx). Kept free of React so the timer formatting and rotating
 * status logic are directly unit-testable without fake timers or a DOM.
 *
 * These are reassurance-only UI concerns - neither the elapsed timer nor the
 * rotating messages represent real server-side progress or completion
 * percentage (the app has no such signal to report); they only tell the user
 * the import is still running and roughly how long it's been going.
 */

/** Rotating reassurance messages shown while an import is processing - order matters (cycled in sequence), wording only, never a real phase signal. */
export const UPLOAD_STATUS_MESSAGES = [
  "Invoer controleren...",
  "Aanbiedingsregels herkennen...",
  "Productgegevens verwerken...",
  "Assortiment koppelen...",
  "Review voorbereiden...",
] as const;

/** How long each rotating status message stays visible before advancing to the next. */
export const STATUS_MESSAGE_INTERVAL_SECONDS = 3;

/**
 * Formats a non-negative elapsed duration as "mm:ss" (e.g. 0 -> "00:00",
 * 23 -> "00:23", 125 -> "02:05"). Negative or non-finite input is clamped to
 * 0 rather than producing "NaN:NaN" or a negative-looking timer.
 */
export function formatElapsedTime(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The index into `UPLOAD_STATUS_MESSAGES` (or any message list of the given
 * length) that should be showing at `elapsedSeconds`. Deterministic and
 * derived directly from the SAME elapsed-seconds counter the timer already
 * tracks - no separate interval/timer needed, and trivially testable without
 * mocking time. Returns 0 for an empty message list.
 */
export function rotatingStatusIndex(
  elapsedSeconds: number,
  messageCount: number,
  intervalSeconds: number = STATUS_MESSAGE_INTERVAL_SECONDS,
): number {
  if (messageCount <= 0) return 0;
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.floor(elapsedSeconds)) : 0;
  const safeInterval = intervalSeconds > 0 ? intervalSeconds : STATUS_MESSAGE_INTERVAL_SECONDS;
  return Math.floor(safeElapsed / safeInterval) % messageCount;
}
