import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Legacy route. Weight profiles (the supplier-assortment links) are now
 * managed exclusively via Assortiment (/products) to avoid two edit flows
 * for the same PackagingWeightProfile rows. This page is kept so the old
 * URL keeps working (backwards compatibility / bookmarks) and simply points
 * the user to Assortiment. The old server actions in ./actions.ts are left
 * in place but are no longer linked from any UI.
 */
export default function WeightProfilesRedirectPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Gewichtsprofielen</h1>
        <p className="text-sm text-gray-500 mt-1">
          Doosgewichten en verpakkingen worden nu beheerd onder <strong>Assortiment</strong>, samen met de
          leverancierskoppeling van elk product.
        </p>
      </div>

      <div className="card p-6">
        <p className="text-sm text-gray-700">
          Elke leverancierskoppeling in Assortiment bevat de leverancier, box/verpakking, het aantal stelen per doos
          en het doosgewicht. Beheer je gewichten daar zodat er geen twee plekken zijn waar dezelfde gegevens kunnen
          worden aangepast.
        </p>
        <Link href="/products" className="btn-primary mt-4 inline-block">
          Naar Assortiment
        </Link>
      </div>
    </div>
  );
}
