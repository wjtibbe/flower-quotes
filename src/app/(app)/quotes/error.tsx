"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Safety net for the quotes route segment: genuine DB/system exceptions
 * (not the business-state cases in `actions.ts`, which redirect back with a
 * clear `?err=` message instead of throwing) still land here. Next.js
 * already keeps the real error/stack server-side ("see the server logs");
 * this boundary only controls what the browser shows, so no Prisma error
 * detail is ever rendered to the user - a short, generic, recoverable
 * message instead of the raw "Application error" crash page.
 */
export default function QuotesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Quotes route error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="card p-6 text-center space-y-3">
      <p className="text-sm text-gray-700">
        Er is een onverwachte fout opgetreden. Probeer het opnieuw of ga terug naar het overzicht.
      </p>
      <div className="flex gap-3 justify-center">
        <button onClick={() => reset()} className="btn-secondary">
          Opnieuw proberen
        </button>
        <Link href="/quotes" className="btn-secondary">
          Naar offertes
        </Link>
      </div>
    </div>
  );
}
