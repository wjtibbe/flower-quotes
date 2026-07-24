"use client";

import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { uploadFarmOffer, type UploadFormState } from "../actions";
import { UPLOAD_STATUS_MESSAGES, formatElapsedTime, rotatingStatusIndex } from "./uploadProgress";

const ACCEPTED_EXTENSIONS = ".pdf,.xlsx,.xls,.csv,.eml,.txt,.png,.jpg,.jpeg,.webp,.gif";
const INITIAL_STATE: UploadFormState = {};

export function UploadForm({ farms }: { farms: { id: string; name: string }[] }) {
  const [state, formAction] = useFormState(uploadFarmOffer, INITIAL_STATE);
  const [source, setSource] = useState<"file" | "text">("file");

  // A local, synchronously-set flag - NOT `useFormStatus().pending` - is the
  // single source of truth for the overlay. Two reasons:
  //  1. It flips to `true` in `onSubmit`, before React even starts the
  //     transition, closing the gap a rapid double-click could otherwise slip
  //     through (the same class of issue fixed for the Confirm-offer button).
  //  2. On SUCCESS the server action calls `redirect()`, which Next.js
  //     handles as a navigation rather than a normal resolved state update -
  //     so this flag is only ever reset on a real ERROR (`state.error`
  //     becoming truthy) and otherwise stays `true` all the way through
  //     navigation, so the overlay never has a chance to flash away and
  //     re-reveal the editable form before the browser navigates (section 7).
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (state.error) setIsSubmitting(false);
  }, [state]);

  useEffect(() => {
    if (!isSubmitting) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isSubmitting]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (isSubmitting) {
      // Belt-and-braces double-submit guard (section 5): the disabled submit
      // button already prevents this in the normal case, but a submit can
      // also be triggered by pressing Enter in a field - block it here too.
      event.preventDefault();
      return;
    }
    setIsSubmitting(true);
  }

  return (
    <div className="relative">
      <form
        action={formAction}
        onSubmit={handleSubmit}
        aria-hidden={isSubmitting}
        className="card p-6 space-y-4"
      >
        {state.error && (
          <div className="rounded-md bg-red-50 border border-red-200 text-sm text-red-700 p-3">{state.error}</div>
        )}

        <div>
          <label className="label">Leverancier *</label>
          <select name="farmId" className="input" required defaultValue="" disabled={isSubmitting}>
            <option value="" disabled>
              Kies een leverancier
            </option>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Titel (optioneel)</label>
          <input name="title" className="input" placeholder="bv. Gutimilko - week 28-31" disabled={isSubmitting} />
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="flex gap-6 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="sourceChoice"
                checked={source === "file"}
                onChange={() => setSource("file")}
                disabled={isSubmitting}
              />
              Upload a file
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="sourceChoice"
                checked={source === "text"}
                onChange={() => setSource("text")}
                disabled={isSubmitting}
              />
              Or paste WhatsApp or email text
            </label>
          </div>
          <p className="text-xs text-gray-400">Use either a file or pasted text, not both.</p>

          {source === "file" ? (
            <input type="file" name="file" className="input" accept={ACCEPTED_EXTENSIONS} disabled={isSubmitting} />
          ) : (
            <textarea
              name="pastedText"
              className="input font-mono text-xs"
              rows={10}
              placeholder={"Paste the WhatsApp or email text here, e.g.:\nDallas 60cm QB x 100 0.38 USD/stem\nFreedom 70cm HB x 50 0.45 USD/stem"}
              disabled={isSubmitting}
            />
          )}
        </div>

        <button type="submit" className="btn-primary disabled:opacity-60" disabled={isSubmitting}>
          {isSubmitting ? "Bezig met uploaden..." : "Uploaden en herkennen"}
        </button>
      </form>

      {isSubmitting && <UploadProgressOverlay elapsedSeconds={elapsedSeconds} />}
    </div>
  );
}

/**
 * Blocking loading overlay shown while the Farm Offer import is processing
 * (section 1). No close button and no backdrop-dismiss - the user cannot
 * close it while processing (section 5/8); it only ever disappears when the
 * parent clears `isSubmitting` (an error) or the page navigates away
 * (success). The elapsed timer and rotating status text are both purely
 * client-side reassurance - neither represents real server-side progress
 * (section 2/4), which is why the progress bar is indeterminate rather than
 * a percentage (section 3).
 */
function UploadProgressOverlay({ elapsedSeconds }: { elapsedSeconds: number }) {
  const statusMessage =
    UPLOAD_STATUS_MESSAGES[rotatingStatusIndex(elapsedSeconds, UPLOAD_STATUS_MESSAGES.length)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-progress-title"
        aria-describedby="upload-progress-description"
        className="card w-full max-w-md p-6 text-center space-y-4"
      >
        <div>
          <h2 id="upload-progress-title" className="font-semibold text-gray-900">
            Aanbieding wordt verwerkt
          </h2>
          <p id="upload-progress-description" className="text-sm text-gray-500 mt-1">
            De aanbieding wordt uitgelezen, verwerkt en gekoppeld aan het assortiment. Bij grote lijsten kan dit even
            duren.
          </p>
        </div>

        <div className="progress-indeterminate-track" aria-hidden="true">
          <div className="progress-indeterminate-bar" />
        </div>

        <div className="text-sm text-gray-700" aria-live="polite">
          <p>{statusMessage}</p>
          <p className="mt-1 font-mono text-gray-500">Bezig: {formatElapsedTime(elapsedSeconds)}</p>
        </div>

        <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
          Blijf op deze pagina. Je wordt automatisch doorgestuurd zodra de verwerking klaar is.
        </p>
      </div>
    </div>
  );
}
