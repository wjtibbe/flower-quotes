/**
 * Seed data for local development and demos.
 *
 * Farm offer sample data below is derived from three real supplier
 * documents used to design the import parser (a Gutimilko farm email, a
 * "La Gaitana Farms" open-market Excel sheet, and a Luz of Roses WhatsApp
 * availability post), but has been anonymized: no personal names, email
 * addresses, phone numbers or signatures are included anywhere below -
 * only farm names, product lines and prices, which is exactly the data the
 * app is designed to work with.
 */
import { PrismaClient, ConfidenceLevel, Currency, DdpCostType, FarmOfferStatus, Incoterm, QuoteStatus, SourceFileType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding...");

  // ---------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------
  const defaultPasswordHash = await bcrypt.hash("Welkom2026!", 10);

  const mike = await prisma.user.upsert({
    where: { email: "mike@flowerquotes.local" },
    update: {},
    create: {
      name: "Mike",
      email: "mike@flowerquotes.local",
      passwordHash: defaultPasswordHash,
      role: UserRole.ADMIN,
    },
  });

  const willemJan = await prisma.user.upsert({
    where: { email: "willem-jan@flowerquotes.local" },
    update: {},
    create: {
      name: "Willem-Jan",
      email: "willem-jan@flowerquotes.local",
      passwordHash: defaultPasswordHash,
      role: UserRole.ADMIN,
    },
  });

  // ---------------------------------------------------------------------
  // Geography
  // ---------------------------------------------------------------------
  const quito = await prisma.origin.upsert({
    where: { city_country: { city: "Quito", country: "Ecuador" } },
    update: {},
    create: { city: "Quito", country: "Ecuador" },
  });
  const bogota = await prisma.origin.upsert({
    where: { city_country: { city: "Bogotá", country: "Colombia" } },
    update: {},
    create: { city: "Bogotá", country: "Colombia" },
  });

  const doha = await prisma.destination.upsert({
    where: { city_country: { city: "Doha", country: "Qatar" } },
    update: {},
    create: { city: "Doha", country: "Qatar" },
  });
  const dubai = await prisma.destination.upsert({
    where: { city_country: { city: "Dubai", country: "United Arab Emirates" } },
    update: {},
    create: { city: "Dubai", country: "United Arab Emirates" },
  });
  const amsterdam = await prisma.destination.upsert({
    where: { city_country: { city: "Amsterdam", country: "Netherlands" } },
    update: {},
    create: { city: "Amsterdam", country: "Netherlands" },
  });

  async function upsertRoute(originId: string, destinationId: string) {
    return prisma.route.upsert({
      where: { originId_destinationId: { originId, destinationId } },
      update: {},
      create: { originId, destinationId },
    });
  }

  const quitoDubai = await upsertRoute(quito.id, dubai.id);
  const quitoDoha = await upsertRoute(quito.id, doha.id);
  const quitoAmsterdam = await upsertRoute(quito.id, amsterdam.id);
  const bogotaDoha = await upsertRoute(bogota.id, doha.id);
  const bogotaDubai = await upsertRoute(bogota.id, dubai.id);
  const bogotaAmsterdam = await upsertRoute(bogota.id, amsterdam.id);

  // Freight rates - intentionally left unrated for Quito->Doha and
  // Bogota->Dubai so the dashboard's "missing freight rate" warning has
  // something real to show.
  await prisma.freightRate.createMany({
    data: [
      { routeId: quitoDubai.id, currency: "USD", ratePerKg: "2.60", notes: "Gemiddeld tarief" },
      { routeId: quitoAmsterdam.id, currency: "USD", ratePerKg: "3.10", notes: "Gemiddeld tarief" },
      { routeId: bogotaDoha.id, currency: "USD", ratePerKg: "2.40", notes: "Gemiddeld tarief" },
      {
        routeId: bogotaAmsterdam.id,
        currency: "USD",
        ratePerKg: "2.90",
        notes: "Bijna verlopen - controleren",
        effectiveTo: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      },
    ],
  });

  // DDP cost rates for the Amsterdam routes (DDP is most relevant for the EU customer).
  for (const route of [quitoAmsterdam, bogotaAmsterdam]) {
    await prisma.ddpCostRate.createMany({
      data: [
        { routeId: route.id, costType: DdpCostType.CLEARING_PER_STEM, currency: "USD", amount: "0.0150" },
        { routeId: route.id, costType: DdpCostType.INSPECTION_PER_STEM, currency: "USD", amount: "0.0100" },
        { routeId: route.id, costType: DdpCostType.HANDLING_PER_BOX, currency: "USD", amount: "1.5000" },
      ],
    });
  }

  // ---------------------------------------------------------------------
  // Exchange rates
  // ---------------------------------------------------------------------
  await prisma.exchangeRate.createMany({
    data: [
      { baseCurrency: Currency.USD, quoteCurrency: Currency.EUR, rate: "0.920000", notes: "Handmatig ingevoerd" },
      { baseCurrency: Currency.EUR, quoteCurrency: Currency.USD, rate: "1.087000", notes: "Handmatig ingevoerd" },
    ],
  });

  // ---------------------------------------------------------------------
  // Farms
  // ---------------------------------------------------------------------
  const gutimilko = await prisma.farm.create({
    data: {
      name: "Gutimilko",
      country: "Ecuador",
      originId: quito.id,
      aliases: { create: [{ alias: "GUTI" }, { alias: "Gutimilko Sales" }] },
    },
  });

  const laGaitana = await prisma.farm.create({
    data: {
      name: "La Gaitana Farms",
      country: "Colombia",
      originId: bogota.id,
      aliases: { create: [{ alias: "La Gaitana" }, { alias: "LGF" }] },
    },
  });

  const luzOfRoses = await prisma.farm.create({
    data: {
      name: "Luz of Roses",
      country: "Ecuador",
      originId: quito.id,
      aliases: { create: [{ alias: "LUZ" }] },
    },
  });

  // ---------------------------------------------------------------------
  // Central product catalog
  // ---------------------------------------------------------------------
  const hydrangea = await prisma.product.create({
    data: {
      productGroup: "Hydrangea",
      name: "Hydrangea",
      aliases: { create: [{ alias: "Hyd" }, { alias: "Hydrangea" }] },
      variants: {
        create: [
          { color: "White", grade: "Select" },
          { color: "White", grade: "Premium" },
          { color: "White", grade: "Jumbo" },
          { color: "Emerald Green", grade: "Select" },
        ],
      },
    },
    include: { variants: true },
  });

  const alstroemeria = await prisma.product.create({
    data: {
      productGroup: "Alstroemeria",
      name: "Alstroemeria",
      aliases: { create: [{ alias: "Alstro" }] },
      variants: {
        create: [
          { variety: "Red Angelina", grade: "Fancy" },
          { variety: "Red Angelina", grade: "Select" },
          { variety: "White Whistler", grade: "Fancy" },
        ],
      },
    },
    include: { variants: true },
  });

  const ruscus = await prisma.product.create({
    data: {
      productGroup: "Foliage",
      name: "Ruscus",
      variants: { create: [{ grade: "Standard" }] },
    },
    include: { variants: true },
  });

  const carnation = await prisma.product.create({
    data: {
      productGroup: "Carnation",
      name: "Carnation",
      aliases: { create: [{ alias: "Carnations" }] },
      variants: {
        create: [
          { color: "Red", variety: "Don Pedro", grade: "Select" },
          { color: "Bicolor Burgundy", variety: "Perfect", grade: "Select" },
        ],
      },
    },
    include: { variants: true },
  });

  const rose = await prisma.product.create({
    data: {
      productGroup: "Rose",
      name: "Rose",
      aliases: { create: [{ alias: "Roses" }] },
      variants: {
        create: [
          { variety: "Be Sweet" },
          { variety: "Explorer" },
          { variety: "Freedom" },
          { variety: "Vendela" },
          { variety: "Mondial" },
          { variety: "Pink Mondial" },
        ],
      },
    },
    include: { variants: true },
  });

  const v = {
    hydWhiteSelect: hydrangea.variants.find((x) => x.grade === "Select" && x.color === "White")!,
    hydWhitePremium: hydrangea.variants.find((x) => x.grade === "Premium")!,
    hydWhiteJumbo: hydrangea.variants.find((x) => x.grade === "Jumbo")!,
    hydEmeraldSelect: hydrangea.variants.find((x) => x.color === "Emerald Green")!,
    alstroRedFancy: alstroemeria.variants.find((x) => x.variety === "Red Angelina" && x.grade === "Fancy")!,
    alstroRedSelect: alstroemeria.variants.find((x) => x.variety === "Red Angelina" && x.grade === "Select")!,
    ruscusStd: ruscus.variants[0],
    carnationRed: carnation.variants.find((x) => x.color === "Red")!,
    roseBeSweet: rose.variants.find((x) => x.variety === "Be Sweet")!,
    roseExplorer: rose.variants.find((x) => x.variety === "Explorer")!,
    roseFreedom: rose.variants.find((x) => x.variety === "Freedom")!,
    roseVendela: rose.variants.find((x) => x.variety === "Vendela")!,
    roseMondial: rose.variants.find((x) => x.variety === "Mondial")!,
    rosePinkMondial: rose.variants.find((x) => x.variety === "Pink Mondial")!,
  };

  // ---------------------------------------------------------------------
  // Packaging / weight profiles
  // ---------------------------------------------------------------------
  await prisma.packagingWeightProfile.createMany({
    data: [
      { farmId: gutimilko.id, productVariantId: v.hydWhiteSelect.id, boxType: "QB", stemsPerBox: 40, weightPerBoxKg: "6.500" },
      { farmId: gutimilko.id, productVariantId: v.hydWhitePremium.id, boxType: "QB", stemsPerBox: 30, weightPerBoxKg: "5.800" },
      { farmId: gutimilko.id, productVariantId: v.hydWhiteJumbo.id, boxType: "QB", stemsPerBox: 15, weightPerBoxKg: "5.200" },
      { farmId: gutimilko.id, productVariantId: v.hydEmeraldSelect.id, boxType: "QB", stemsPerBox: 40, weightPerBoxKg: "6.700" },
      { farmId: gutimilko.id, productVariantId: v.alstroRedFancy.id, boxType: "QB", stemsPerBox: 200, weightPerBoxKg: "7.000" },
      { farmId: gutimilko.id, productVariantId: v.alstroRedSelect.id, boxType: "QB", stemsPerBox: 160, weightPerBoxKg: "6.400" },
      { farmId: gutimilko.id, productVariantId: v.ruscusStd.id, boxType: "QB", stemsPerBox: 300, weightPerBoxKg: "9.500" },
      { farmId: laGaitana.id, productVariantId: v.carnationRed.id, boxType: "QB", stemsPerBox: 250, weightPerBoxKg: "10.000" },
      { farmId: luzOfRoses.id, productVariantId: v.roseBeSweet.id, boxType: "HB", stemsPerBox: 25, weightPerBoxKg: "8.000" },
      { farmId: luzOfRoses.id, productVariantId: v.roseExplorer.id, boxType: "HB", stemsPerBox: 25, weightPerBoxKg: "8.200" },
      { farmId: luzOfRoses.id, productVariantId: v.roseFreedom.id, boxType: "HB", stemsPerBox: 25, weightPerBoxKg: "8.100" },
      { farmId: luzOfRoses.id, productVariantId: v.roseVendela.id, boxType: "HB", stemsPerBox: 25, weightPerBoxKg: "8.000" },
    ],
  });

  // ---------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------
  await prisma.customer.createMany({
    data: [
      {
        companyName: "Amsterdam Bloom BV",
        contactName: "Sales desk",
        email: "sales@example-amsterdambloom.test",
        destinationId: amsterdam.id,
        defaultCurrency: Currency.EUR,
        defaultIncoterm: Incoterm.DDP,
        defaultMarginPercent: "18.000",
      },
      {
        companyName: "Gulf Fresh Flowers LLC",
        contactName: "Procurement",
        email: "procurement@example-gulffresh.test",
        destinationId: dubai.id,
        defaultCurrency: Currency.USD,
        defaultIncoterm: Incoterm.FOB,
        defaultMarginPercent: "12.000",
      },
      {
        companyName: "Doha Garden Trading",
        contactName: "Buying office",
        email: "buying@example-dohagarden.test",
        destinationId: doha.id,
        defaultCurrency: Currency.USD,
        defaultIncoterm: Incoterm.CFR,
        defaultMarginPercent: "15.000",
      },
    ],
  });

  // ---------------------------------------------------------------------
  // Sample farm offers (anonymized - no personal names/emails/signatures)
  // ---------------------------------------------------------------------
  const gutiUpload = await prisma.sourceUpload.create({
    data: {
      fileType: SourceFileType.PDF,
      originalName: "gutimilko-week28-31-offer.pdf",
      storagePath: "storage/uploads/seed/gutimilko-week28-31-offer.pdf",
      uploadedById: willemJan.id,
      rawText: [
        "Hyd White select 30QBx40 $0,45 | Tinted $0,60",
        "Hyd White prem 100qbx30 $0,55 | Tinted $0,70",
        "Hyd White jumbo 20QBx15 $1,20",
        "Hyd emerald green select 30QBx40 $0,79",
        "Alstro red angelina fancy 10qb*200 $0,15",
        "Alstro red angelina select 20qb*160 $0,18",
        "Ruscus 100QBx300 $0,13 | tinted $0,26",
      ].join("\n"),
    },
  });

  const gutiOffer = await prisma.farmOffer.create({
    data: {
      farmId: gutimilko.id,
      sourceUploadId: gutiUpload.id,
      title: "Gutimilko - Week 28-31 mid-summer promo",
      offerDate: new Date("2026-07-08"),
      validUntil: new Date("2026-07-15"),
      status: FarmOfferStatus.REVIEWED,
      createdById: willemJan.id,
      lines: {
        create: [
          {
            rawText: "Hyd White select 30QBx40 $0,45 | Tinted $0,60",
            productVariantId: v.hydWhiteSelect.id,
            farmNameRaw: "Gutimilko",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Hydrangea",
            colorRaw: "White",
            gradeRaw: "Select",
            treatmentRaw: "normal",
            boxType: "QB",
            boxesAvailable: 30,
            stemsPerBox: 40,
            fobPricePerStem: "0.4500",
            currency: Currency.USD,
            weightPerBoxKg: "6.500",
            confidence: ConfidenceLevel.HIGH,
            needsReview: false,
          },
          {
            rawText: "Hyd White select 30QBx40 $0,45 | Tinted $0,60",
            productVariantId: v.hydWhiteSelect.id,
            farmNameRaw: "Gutimilko",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Hydrangea",
            colorRaw: "White",
            gradeRaw: "Select",
            treatmentRaw: "tinted",
            boxType: "QB",
            boxesAvailable: 30,
            stemsPerBox: 40,
            fobPricePerStem: "0.6000",
            currency: Currency.USD,
            weightPerBoxKg: "6.500",
            confidence: ConfidenceLevel.HIGH,
            needsReview: false,
          },
          {
            rawText: "Hyd White prem 100qbx30 $0,55 | Tinted $0,70",
            productVariantId: v.hydWhitePremium.id,
            farmNameRaw: "Gutimilko",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Hydrangea",
            colorRaw: "White",
            gradeRaw: "Premium",
            treatmentRaw: "normal",
            boxType: "QB",
            boxesAvailable: 100,
            stemsPerBox: 30,
            fobPricePerStem: "0.5500",
            currency: Currency.USD,
            weightPerBoxKg: "5.800",
            confidence: ConfidenceLevel.HIGH,
            needsReview: false,
          },
          {
            rawText: "Hyd White jumbo 20QBx15 $1,20",
            productVariantId: v.hydWhiteJumbo.id,
            farmNameRaw: "Gutimilko",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Hydrangea",
            colorRaw: "White",
            gradeRaw: "Jumbo",
            treatmentRaw: "normal",
            boxType: "QB",
            boxesAvailable: 20,
            stemsPerBox: 15,
            fobPricePerStem: "1.2000",
            currency: Currency.USD,
            weightPerBoxKg: "5.200",
            confidence: ConfidenceLevel.HIGH,
            needsReview: false,
          },
          {
            rawText: "Alstro red angelina fancy 10qb*200 $0,15",
            productVariantId: v.alstroRedFancy.id,
            farmNameRaw: "Gutimilko",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Alstroemeria",
            varietyRaw: "Red Angelina",
            gradeRaw: "Fancy",
            treatmentRaw: "normal",
            boxType: "QB",
            boxesAvailable: 10,
            stemsPerBox: 200,
            fobPricePerStem: "0.1500",
            currency: Currency.USD,
            weightPerBoxKg: "7.000",
            confidence: ConfidenceLevel.HIGH,
            needsReview: false,
          },
          {
            rawText: "Ruscus 100QBx300 $0,13 | tinted $0,26",
            productVariantId: v.ruscusStd.id,
            farmNameRaw: "Gutimilko",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Ruscus",
            treatmentRaw: "normal",
            boxType: "QB",
            boxesAvailable: 100,
            stemsPerBox: 300,
            fobPricePerStem: "0.1300",
            currency: Currency.USD,
            weightPerBoxKg: "9.500",
            confidence: ConfidenceLevel.HIGH,
            needsReview: false,
          },
          {
            // Deliberately left as a low-confidence, unlinked line to demo the review flow.
            rawText: "Eucalipto baby blue 20QB*200 $0,23 (Additional time required 72 HR)",
            farmNameRaw: "Gutimilko",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Eucalyptus",
            varietyRaw: "Baby Blue",
            treatmentRaw: "normal",
            boxType: "QB",
            boxesAvailable: 20,
            stemsPerBox: 200,
            fobPricePerStem: "0.2300",
            currency: Currency.USD,
            extraLeadTimeHrs: 72,
            confidence: ConfidenceLevel.MEDIUM,
            needsReview: true,
          },
        ],
      },
    },
  });

  const omUpload = await prisma.sourceUpload.create({
    data: {
      fileType: SourceFileType.EXCEL,
      originalName: "open-market-fca-bogota.xlsx",
      storagePath: "storage/uploads/seed/open-market-fca-bogota.xlsx",
      uploadedById: mike.id,
      rawText: "Product | Color | Variety | Grade | FOB BTA | STEMS X QB\nCarnations | Red | Don pedro | sel | 0.20 | 250",
    },
  });

  await prisma.farmOffer.create({
    data: {
      farmId: laGaitana.id,
      sourceUploadId: omUpload.id,
      title: "La Gaitana Farms - Open Market",
      offerDate: new Date("2026-07-09"),
      status: FarmOfferStatus.REVIEWED,
      createdById: mike.id,
      lines: {
        create: [
          {
            rawText: "Carnations | Red | Don pedro | sel | 0 | 5000 | 20 | 5000 | 0.2 | 0.26 | 0.31 | 0.3 | 250 | 0.3",
            productVariantId: v.carnationRed.id,
            farmNameRaw: "La Gaitana Farms",
            countryOfOrigin: "Colombia",
            originId: bogota.id,
            productGroupRaw: "Carnation",
            colorRaw: "Red",
            varietyRaw: "Don Pedro",
            gradeRaw: "Select",
            treatmentRaw: "normal",
            boxType: "QB",
            boxesAvailable: 20,
            stemsPerBox: 250,
            fobPricePerStem: "0.2000",
            currency: Currency.USD,
            weightPerBoxKg: "10.000",
            confidence: ConfidenceLevel.HIGH,
            needsReview: false,
          },
        ],
      },
    },
  });

  const luzUpload = await prisma.sourceUpload.create({
    data: {
      fileType: SourceFileType.IMAGE,
      originalName: "luz-of-roses-disponible-070726.jpg",
      storagePath: "storage/uploads/seed/luz-of-roses-disponible-070726.jpg",
      uploadedById: mike.id,
      rawText: "DISPONIBLE - LUZ OF ROSES\nMartes 07/07/2026\n1 HB BE SWEET 70 CM\n2 HB BE SWEET 60 CM\n1 HB EXPLORER 70 CM\n1 HB FREEDOM 70 CM\n1 HB VENDELA 60 CM",
    },
  });

  await prisma.farmOffer.create({
    data: {
      farmId: luzOfRoses.id,
      sourceUploadId: luzUpload.id,
      title: "Luz of Roses - Beschikbaarheid 07/07/2026 (geen prijzen opgegeven)",
      offerDate: new Date("2026-07-07"),
      status: FarmOfferStatus.DRAFT,
      createdById: mike.id,
      lines: {
        create: [
          {
            rawText: "1 HB BE SWEET 70 CM",
            productVariantId: v.roseBeSweet.id,
            farmNameRaw: "Luz of Roses",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Rose",
            varietyRaw: "Be Sweet",
            gradeRaw: "70 cm",
            treatmentRaw: "normal",
            boxType: "HB",
            boxesAvailable: 1,
            stemsPerBox: 25,
            currency: Currency.USD,
            weightPerBoxKg: "8.000",
            confidence: ConfidenceLevel.LOW,
            needsReview: true,
            notes: "Geen FOB-prijs op de bron - handmatig aanvullen vóór offerte.",
          },
          {
            rawText: "1 HB EXPLORER 70 CM",
            productVariantId: v.roseExplorer.id,
            farmNameRaw: "Luz of Roses",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Rose",
            varietyRaw: "Explorer",
            gradeRaw: "70 cm",
            treatmentRaw: "normal",
            boxType: "HB",
            boxesAvailable: 1,
            stemsPerBox: 25,
            currency: Currency.USD,
            weightPerBoxKg: "8.200",
            confidence: ConfidenceLevel.LOW,
            needsReview: true,
            notes: "Geen FOB-prijs op de bron - handmatig aanvullen vóór offerte.",
          },
          {
            rawText: "1 HB VENDELA 60 CM",
            productVariantId: v.roseVendela.id,
            farmNameRaw: "Luz of Roses",
            countryOfOrigin: "Ecuador",
            originId: quito.id,
            productGroupRaw: "Rose",
            varietyRaw: "Vendela",
            gradeRaw: "60 cm",
            treatmentRaw: "normal",
            boxType: "HB",
            boxesAvailable: 1,
            stemsPerBox: 25,
            currency: Currency.USD,
            weightPerBoxKg: "8.000",
            confidence: ConfidenceLevel.LOW,
            needsReview: true,
            notes: "Geen FOB-prijs op de bron - handmatig aanvullen vóór offerte.",
          },
        ],
      },
    },
  });

  console.log("Seed complete.");
  console.log(`Users: ${mike.email}, ${willemJan.email} (password: Welkom2026! - change after first login)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
