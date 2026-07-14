import { prisma } from "@/lib/db";
import { uploadFarmOffer } from "../actions";

export const dynamic = "force-dynamic";

export default async function UploadFarmOfferPage() {
  const farms = await prisma.farm.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Nieuwe leveranciersaanbieding uploaden</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ondersteund: screenshots/afbeeldingen, PDF, e-mailbestanden (.eml/.txt) en Excel. De app leest de inhoud
          automatisch uit; je controleert en corrigeert de herkende regels op het volgende scherm.
        </p>
      </div>

      <form action={uploadFarmOffer} className="card p-6 space-y-4">
        <div>
          <label className="label">Bestand *</label>
          <input
            type="file"
            name="file"
            required
            className="input"
            accept=".pdf,.xlsx,.xls,.csv,.eml,.txt,.png,.jpg,.jpeg,.webp"
          />
        </div>
        <div>
          <label className="label">Leverancier (optioneel, kan later gekoppeld worden)</label>
          <select name="farmId" className="input">
            <option value="">Onbekend / later koppelen</option>
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

        <button type="submit" className="btn-primary">
          Uploaden en herkennen
        </button>
      </form>
    </div>
  );
}
