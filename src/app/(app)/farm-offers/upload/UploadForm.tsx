"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { uploadFarmOffer, type UploadFormState } from "../actions";

const ACCEPTED_EXTENSIONS = ".pdf,.xlsx,.xls,.csv,.eml,.txt,.png,.jpg,.jpeg,.webp,.gif";
const INITIAL_STATE: UploadFormState = {};

export function UploadForm({ farms }: { farms: { id: string; name: string }[] }) {
  const [state, formAction] = useFormState(uploadFarmOffer, INITIAL_STATE);
  const [source, setSource] = useState<"file" | "text">("file");

  return (
    <form action={formAction} className="card p-6 space-y-4">
      {state.error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-sm text-red-700 p-3">{state.error}</div>
      )}

      <div>
        <label className="label">Leverancier *</label>
        <select name="farmId" className="input" required defaultValue="">
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
        <input name="title" className="input" placeholder="bv. Gutimilko - week 28-31" />
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex gap-6 text-sm text-gray-700">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="sourceChoice"
              checked={source === "file"}
              onChange={() => setSource("file")}
            />
            Upload a file
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="sourceChoice"
              checked={source === "text"}
              onChange={() => setSource("text")}
            />
            Or paste WhatsApp or email text
          </label>
        </div>
        <p className="text-xs text-gray-400">Use either a file or pasted text, not both.</p>

        {source === "file" ? (
          <input type="file" name="file" className="input" accept={ACCEPTED_EXTENSIONS} />
        ) : (
          <textarea
            name="pastedText"
            className="input font-mono text-xs"
            rows={10}
            placeholder={"Paste the WhatsApp or email text here, e.g.:\nDallas 60cm QB x 100 0.38 USD/stem\nFreedom 70cm HB x 50 0.45 USD/stem"}
          />
        )}
      </div>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary disabled:opacity-60" disabled={pending}>
      {pending ? "Bezig met uploaden..." : "Uploaden en herkennen"}
    </button>
  );
}
