import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Legacy route. DDP costs (clearing/inspection/handling) are now managed as
 * "aanvullende kosten" per route under Routes & vracht, alongside the other
 * route cost categories. This page is kept so the old URL keeps working and
 * points users to the new place; the old server actions in ./actions.ts
 * remain in place but are no longer linked from any UI.
 */
export default function DdpCostsRedirectPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">DDP-kosten</h1>
        <p className="text-sm text-gray-500 mt-1">
          DDP-kosten worden nu beheerd als <strong>aanvullende kosten</strong> per route onder Routes &amp; vracht -
          samen met import, documentatie, lokale bezorging en overige kosten.
        </p>
      </div>

      <div className="card p-6">
        <p className="text-sm text-gray-700">
          Open een route onder Routes &amp; vracht en klap "Tarieven &amp; instellingen" uit. Daar staat het blok
          "Aanvullende kosten (DDP)" met clearing, inspection, handling en alle andere kostencategorieën, elk met een
          eigen rekeneenheid en geldigheidsperiode.
        </p>
        <Link href="/routes" className="btn-primary mt-4 inline-block">
          Naar Routes &amp; vracht
        </Link>
      </div>
    </div>
  );
}
