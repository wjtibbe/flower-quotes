import { prisma } from "@/lib/db";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadFarmOfferPage() {
  const farms = await prisma.farm.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Nieuwe leveranciersaanbieding uploaden</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ondersteund: screenshots/afbeeldingen, PDF, e-mailbestanden (.eml/.txt), Excel (.xlsx/.csv), en geplakte
          WhatsApp- of e-mailtekst. De app leest de inhoud automatisch uit; je controleert en corrigeert de herkende
          regels op het volgende scherm.
        </p>
      </div>

      <UploadForm farms={farms} />
    </div>
  );
}
