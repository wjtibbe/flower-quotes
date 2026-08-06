export const dynamic = "force-dynamic";

export default function SettingsGeneralPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Algemeen</h1>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-gray-800 mb-2">Afrondingsinstellingen</h2>
        <p className="text-sm text-gray-600">
          Interne berekeningen gebruiken minimaal 6 decimalen precisie (decimal arithmetic, geen floating point).
          Verkoopprijzen worden getoond met 2 decimalen, met normale wiskundige afronding (round-half-up). Deze
          instelling is centraal gedefinieerd in de prijsengine en kan per klant worden uitgebreid met afwijkende
          afrondingsregels in een volgende versie.
        </p>
      </div>
    </div>
  );
}
