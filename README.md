# Flower Quotes

Interne aanbiedingsapp voor de internationale bloemenhandel (MVP). Bouwt klantaanbiedingen op basis van
farm-aanbiedingen (PDF, e-mail, Excel, screenshots), berekent verkoopprijzen per klant, en exporteert de offerte als
WhatsApp-tekst, e-mailtekst en Excel.

## 1. Technische stack

| Laag | Keuze | Waarom |
|---|---|---|
| Framework | Next.js 14 (App Router, TypeScript) | Eén codebase voor UI + server logica (Server Actions), geen aparte API-laag nodig voor een 2-persoons interne tool. Grote onderhoudscommunity. |
| Database | PostgreSQL | Native `NUMERIC`/`Decimal`-ondersteuning (nodig voor geldberekeningen zonder floating point), robuuste concurrency voor meerdere gelijktijdige gebruikers, en de voor de hand liggende keuze om later te schalen. |
| ORM | Prisma | Type-safe queries, ingebouwde migraties, leesbaar schema als levende documentatie van het datamodel. |
| Auth | NextAuth.js (Credentials provider, JWT-sessies) | Simpele, veilige e-mail/wachtwoord-login voor interne medewerkers; geen externe IdP nodig voor 2 gebruikers, wel uitbreidbaar. |
| Geldberekeningen | decimal.js | Decimal arithmetic i.p.v. floats, met expliciete precisie/afrondingsinstellingen - zie `src/lib/pricing`. |
| Bestandsverwerking | `pdf-parse` (tekst-PDF), `exceljs` (Excel), eigen regex/heuristiek-parser (vrije tekst/e-mail) | Zie sectie 5 (import-architectuur). |
| Styling | Tailwind CSS | Snel, consistent, geen aparte design-system-afhankelijkheid nodig voor een interne tool. |
| Tests | Vitest | Snel, TypeScript-native, goed voor de prijsengine en parser (pure functies, makkelijk te unit-testen). |

## 2. Architectuuroverzicht

```
├── prisma/
│   ├── schema.prisma       # volledig datamodel (20 entiteiten, zie sectie 4)
│   ├── migrations/
│   └── seed.ts             # seed data, zie sectie 6
├── src/
│   ├── app/
│   │   ├── login/          # inlogscherm
│   │   └── (app)/          # alle interne schermen (auth-protected via middleware)
│   │       ├── dashboard/
│   │       ├── farm-offers/        # upload, lijst, detail, importcontrole
│   │       ├── quotes/             # wizard, detail/preview, historie
│   │       ├── products/ farms/ weight-profiles/ routes/ ddp-costs/
│   │       ├── customers/ exchange-rates/ settings/
│   │       └── api/exports/[exportId]/  # geauthenticeerde download van gegenereerde bestanden
│   ├── lib/
│   │   ├── pricing/        # de prijsengine (puur, geen DB-afhankelijkheid), zie sectie 7
│   │   ├── import/         # de import/parse-pijplijn, zie sectie 5
│   │   ├── exports/        # WhatsApp/e-mail/Excel generatie
│   │   ├── quotePricing.ts # verbindt DB (routes/tarieven/wisselkoersen) met de prijsengine
│   │   ├── auth.ts, db.ts, format.ts, quoteNumber.ts
│   └── middleware.ts       # blokkeert alle routes behalve /login voor niet-ingelogde gebruikers
└── storage/
    ├── uploads/             # bronbestanden (nooit publiek serveerbaar)
    └── exports/             # gegenereerde Excel-bestanden (idem)
```

Elk scherm dat data muteert gebruikt een Next.js **Server Action** (`"use server"` functies in `actions.ts` per
sectie) - geen aparte REST-API nodig, wel dezelfde server-side validatie en auth-checks als een API-route zou hebben.

## 3. Belangrijkste aannames

Waar de opdracht een verstandige standaardkeuze toestond, is het volgende aangenomen (en hier gedocumenteerd zodat
het expliciet te herzien is):

1. **Eén Postgres-database, geen multi-tenant scheiding** - twee interne gebruikers, geen klantscheiding nodig.
2. **Incoterm "C&F" wordt intern als `CFR`** opgeslagen (de correcte Incoterms-code voor hetzelfde begrip); de UI
   toont overal "C&F".
3. **FreightRate/DdpCostRate-historie**: een nieuw tarief deactiveert het vorige (i.p.v. een harde einddatum te
   vereisen) - zo blijft geschiedenis intact zonder dat de gebruiker elke keer een einddatum hoeft in te vullen.
4. **Eén valuta-conversie tegelijk**: alleen USD⇄EUR is uitgewerkt (zoals gevraagd); het datamodel (los
   `baseCurrency`/`quoteCurrency`/`rate`) is direct uitbreidbaar naar meer valuta.
5. **Weightgewicht-matching** gebeurt op het moment dat een offerteregel aan een centraal product wordt gekoppeld
   (niet al bij upload, omdat er op dat moment nog geen bevestigde koppeling is) - zie `updateOfferLine` in
   `src/app/(app)/farm-offers/actions.ts`.
6. **OCR is niet geïmplementeerd** in deze MVP (zie Risico's). Screenshots/foto's en niet-doorzoekbare PDF's vallen
   terug op handmatige invoer, wat expliciet als vereiste fallback in de opdracht staat.
7. **Eén centraal product = Product + ProductVariant** (variëteit/kleur/kwaliteit/behandeling). Alias-matching
   gebeurt op basis van tekstgelijkenis (Levenshtein) over de samengestelde variant-naam, in plaats van een aparte
   alias-tabel per variant - dit dekt de in de opdracht genoemde voorbeelden (hoofdletters, "sel." vs "Select") al
   correct af zonder extra schema-complexiteit.
8. **Eén offerte = één klant** (zoals het datamodel in sectie 22 van de opdracht voorschrijft). Bij het selecteren
   van meerdere klanten in de offertewizard wordt per klant een aparte offerte aangemaakt.
9. **Regels die niet kunnen worden doorgerekend** (bijv. ontbrekende FOB-prijs) worden bij offerte-aanmaak stilzwijgend
   overgeslagen in plaats van de hele actie te blokkeren - de gebruiker ziet dan een offerte met minder regels dan
   geselecteerd en kan de brondata alsnog aanvullen.
10. **Standaardwachtwoord voor seed-gebruikers**: `Welkom2026!` - alleen bedoeld voor lokale ontwikkeling, wijzig dit
    bij een echte deployment.

## 4. Datamodel

Zie `prisma/schema.prisma` voor het volledige, geannoteerde schema. Alle 20 vereiste entiteiten zijn aanwezig:
`users, farms, farm_aliases, products, product_aliases, product_variants, packaging_weight_profiles, origins,
destinations, routes, freight_rates, ddp_cost_rates, customers, exchange_rates, source_uploads, farm_offers,
farm_offer_lines, quotes, quote_lines, quote_exports`. UUID's als primary key, `active`/soft-delete-vlaggen op
referentiedata, `createdAt`/`updatedAt` (+ `createdBy` waar relevant) op elke business-entiteit.

Geldbedragen, gewichten en percentages zijn overal Prisma `Decimal` (PostgreSQL `NUMERIC`) - nooit `Float`.

## 5. Import-architectuur (AI-parser)

De importmodule (`src/lib/import/`) is opgesplitst in de stappen uit sectie 24 van de opdracht:

1. `extract/detectFileType.ts` - bestandstype herkennen (extensie + MIME-type).
2. `extract/pdfText.ts`, `extract/excelTable.ts`, `extract/emailText.ts`, `extract/imageText.ts` - tekst/tabel
   extraheren. Excel probeert eerst kolommen direct uit te lezen (`excelParser.ts`); tekst-PDF's en e-mails krijgen
   eerst gewone tekstextractie; OCR is alleen de laatste fallback voor afbeeldingen/niet-doorzoekbare PDF's.
3. `segment.ts` - regels segmenteren (filtert e-mailgroeten/headers/handtekeningen uit ongestructureerde tekst).
4. `lineParser.ts` - velden herkennen met regex/heuristiek, inclusief komma/punt-decimalen en QB/QBx/qb\*/qbx-varianten.
5. `aliasMatching.ts` - stelt een waarschijnlijke farm/product-koppeling voor (Levenshtein-gebaseerd), koppelt nooit
   automatisch.
6. Confidence per regel én per veld (`hoog`/`middel`/`laag`), nooit stilzwijgend als waarheid opgeslagen.
7. `validation.ts` (in de prijsengine) - harde blockers pas bij offerte-berekening, niet bij opslaan van de aanbieding.
8. Gebruikerscontrole: het importcontrole-scherm (`farm-offers/[id]/review`).
9. Definitief opslaan pas na expliciete bevestiging door de gebruiker.

**AI-provider is een vervangbare service-interface** (`ImportParserProvider` in `src/lib/import/types.ts`):

- Standaard: `RuleBasedParserProvider` - gratis, deterministisch, geen API-key nodig. Dit is wat alle tests en de
  meegeleverde seed-/testdata gebruiken.
- Optioneel: `AnthropicParserProvider` - wordt automatisch gebruikt zodra `ANTHROPIC_API_KEY` in `.env` staat. Zelfde
  interface, dus de rest van de app hoeft niet te weten welke provider actief is. Output wordt altijd gevalideerd
  voordat die als concept-regel verschijnt.

Deze parser is getest tegen de drie meegeleverde echte voorbeeldbestanden (Gutimilko e-mail, "Open Market" Excel,
Luz of Roses WhatsApp-screenshot) via een browser-gestuurde end-to-end test - zie sectie 9.

## 6. Seed data

`prisma/seed.ts` bevat, geanonimiseerd (geen namen, e-mailadressen of handtekeningen uit de brondocumenten):

- Gebruikers **Mike** en **Willem-Jan** (wachtwoord `Welkom2026!`)
- Herkomsten **Quito** en **Bogotá**, bestemmingen **Doha**, **Dubai**, **Amsterdam**
- 6 routes, 4 vrachttarieven (bewust 2 routes zonder tarief, en 1 tarief dat bijna verloopt - voor dashboard-demo),
  DDP-kosten voor de Amsterdam-routes
- Wisselkoersen USD→EUR en EUR→USD
- 3 farms (**Gutimilko**, **La Gaitana Farms**, **Luz of Roses**) met aliassen
- Een productcatalogus (Hydrangea, Alstroemeria, Ruscus, Carnation, Rose) met varianten en gewichtsprofielen
- 3 klanten met verschillende valuta/incoterm/marge-combinaties
- 3 farm-aanbiedingen met regels die overeenkomen met de echte voorbeeldbestanden - inclusief één aanbieding
  (Luz of Roses) zonder FOB-prijs, om de "controleer ontbrekende gegevens"-flow te demonstreren.

## 7. Prijsengine

`src/lib/pricing/` is volledig los van de database (pure functies + decimal.js) en dekt sectie 11 van de opdracht
één-op-één: FOB/C&F/DDP-kostprijsopbouw, vracht- en handling-per-steel, valutaconversie, marge, centrale
afronding (6+ decimalen intern, 2 decimalen tonen, round-half-up), en harde-blocker-validatie (sectie 19).
`src/lib/quotePricing.ts` is de enige plek die database-gegevens (routes, tarieven, wisselkoersen) omzet naar de
input van de prijsengine.

## 8. Installatie

Vereisten: Node.js 20+, PostgreSQL 14+.

```bash
git clone https://github.com/wjtibbe/flower-quotes
cd flower-quotes
npm install
cp .env.example .env          # pas DATABASE_URL/NEXTAUTH_SECRET aan indien nodig
npx prisma migrate dev         # maakt tabellen aan
npm run db:seed                # laadt voorbeelddata (of: npm run db:reset voor migrate+seed in één stap)
npm run dev                    # start op http://localhost:3000
```

Login met `mike@flowerquotes.local` / `Welkom2026!` (of `willem-jan@flowerquotes.local`).

### Tests

```bash
npm test          # eenmalig
npm run test:watch
```

58 unit tests, met name gericht op de prijsengine (elk vereist testgeval uit sectie 23 van de opdracht) en de
import-parser (tegen echte voorbeeldregels).

## 9. Live deployen (zodat je de app in de browser kunt gebruiken)

De snelste manier om de app zonder eigen server te gebruiken: **Vercel** (host de app, gratis) + **Neon**
(gratis PostgreSQL-database in de cloud). Geen terminal nodig na deze stappen.

1. **Database maken (Neon)**
   - Ga naar [neon.tech](https://neon.tech) en maak een gratis account/project aan.
   - Kopieer de **connection string** die Neon toont (begint met `postgresql://...`). Dit wordt zo zowel je
     `DATABASE_URL` als je `DIRECT_URL` (Neon heeft geen aparte pooled/direct-strings zoals Supabase - dezelfde
     waarde in beide is prima).

2. **App hosten (Vercel)**
   - Ga naar [vercel.com](https://vercel.com), log in met je GitHub-account en klik "Add New… → Project".
   - Kies de repository `wjtibbe/flower-quotes`.
   - Bij "Environment Variables" voeg je toe:
     - `DATABASE_URL` → de connection string van Neon (stap 1)
     - `DIRECT_URL` → dezelfde connection string als `DATABASE_URL`
     - `NEXTAUTH_SECRET` → een lange willekeurige tekst (bijv. gegenereerd op [passwordsgenerator.net](https://passwordsgenerator.net) met 40+ tekens)
     - `NEXTAUTH_URL` → laat dit eerst leeg; je zet dit ná de eerste deploy op de URL die Vercel je geeft (bijv. `https://flower-quotes.vercel.app`)
     - `ADMIN_SEED_TOKEN` → een willekeurig wachtwoord dat je zelf verzint (onthoud dit, nodig in stap 3)
   - Klik "Deploy". Vercel installeert alles en voert automatisch de database-migraties uit.

3. **Voorbeelddata laden (eenmalig, via de browser)**
   - Zodra de deploy klaar is, open je: `https://<jouw-vercel-url>/api/admin/seed?token=<jouw ADMIN_SEED_TOKEN>`
   - Je ziet een bevestigingsbericht in het scherm. Klaar - de app bevat nu Mike, Willem-Jan, voorbeeldfarms,
     klanten en aanbiedingen.

4. **NEXTAUTH_URL alsnog instellen**
   - Ga terug naar je Vercel-project → Settings → Environment Variables, vul `NEXTAUTH_URL` in met je echte
     Vercel-URL, en klik "Redeploy" (Deployments-tab → "..." → Redeploy).

5. **Inloggen**
   - Ga naar je Vercel-URL, log in met `willem-jan@flowerquotes.local` / `Welkom2026!` (of `mike@flowerquotes.local`).
   - Wijzig het wachtwoord daarna via het "Instellingen"-scherm (nieuwe medewerker aanmaken met een eigen wachtwoord
     is op dit moment de manier om dat te doen; een "wachtwoord wijzigen"-knop voor het eigen account is een goede
     vervolgstap).

Elke nieuwe `git push` naar de `main`-branch van de repository deployt automatisch een nieuwe versie op Vercel.

> **Supabase in plaats van Neon?** Kan ook - Supabase is ook gewoon PostgreSQL. Gebruik dan bij stap 1/2 Supabase's
> **"Connection pooling"**-string (poort 6543) als `DATABASE_URL`, en de **"Direct connection"**-string (poort 5432)
> als `DIRECT_URL` - dat onderscheid bestaat bij Neon niet, maar is bij Supabase nodig omdat migraties niet via de
> pooled/pgbouncer-verbinding kunnen lopen.

## 10. Wat is getest, wat niet

- **Prijsengine**: 46 unit tests (vracht/steel, handling/steel, FOB/C&F/DDP, marge, valutaconversie, afronding,
  ontbrekende data, nul stelen per doos, offerte-snapshot-onveranderlijkheid).
- **Parser**: 12 unit tests tegen echte GUTI-farmregels en de "Open Market"-Exceltabel.
- **End-to-end (handmatig, browser-gestuurd tijdens ontwikkeling)**: inloggen → PDF/Excel uploaden → regels
  automatisch herkend → regel koppelen aan centraal product → gewicht automatisch gevonden → klant + route + incoterm
  + vrachttarief + DDP-kosten + wisselkoers → volledige berekening bekeken → offerte aangemaakt → WhatsApp-tekst,
  e-mailtekst, klant-Excel en interne Excel gegenereerd en gedownload → prijs handmatig overschreven → status
  gewijzigd → teruggevonden in offertehistorie. Dit dekt de volledige Definition of Done uit sectie 27.
- **Niet geautomatiseerd**: er is geen Playwright-testsuite in de repository opgenomen (de browser-tests hierboven
  waren wegwerpscripts tijdens de bouw). Een vervolgstap zou zijn deze als `npm run test:e2e` vast te leggen.

## 11. Bekende beperkingen / risico's voor een volgende iteratie

1. **Geen OCR** - screenshots/foto's en niet-doorzoekbare PDF's vereisen nu volledig handmatige invoer. De
   architectuur (`src/lib/import/extract/imageText.ts`) is al voorbereid om een OCR-engine (bijv. Tesseract.js of een
   cloud-OCR-API) achter dezelfde functie-signatuur te hangen.
   Bewijs uit `e2e_upload` test tijdens ontwikkeling: PDF- en Excel-import werken al met de echte voorbeeldbestanden.
2. **Excel-formules zonder gecachte waarde** (shared-formula "master"-cellen zonder opgeslagen resultaat) worden
   overgeslagen in plaats van herberekend - alleen relevant voor afgeleide/berekende kolommen, niet voor de kolommen
   die daadwerkelijk in prijzen worden gebruikt (die zijn in het testbestand altijd platte waarden).
3. **Eén margeregel** (percentage-opslag op kostprijs) - vaste-bedragmarges of getrapte marges zijn niet
   geïmplementeerd, maar passen binnen de bestaande `PriceLineInput`-interface.
4. **Rolgebaseerde autorisatie is voorbereid maar niet afgedwongen** - `UserRole` (`ADMIN`/`SALES`/`READ_ONLY`)
   bestaat in het datamodel en de sessie, maar alle ingelogde gebruikers hebben momenteel gelijke rechten op elk
   scherm. Een volgende stap is per-actie rolchecks toevoegen.
5. **Geen automatische e-mail-/WhatsApp-verzending** - bewust buiten scope voor v1, zoals gevraagd (kopiëren volstaat).

## 12. Veiligheid

- Elke pagina behalve `/login` en de NextAuth-routes is afgeschermd door `middleware.ts` (server-side sessiecheck).
- Wachtwoorden worden gehasht met bcrypt, nooit in platte tekst opgeslagen of gelogd.
- Geüploade bestanden en gegenereerde exports staan buiten `public/` en worden alleen via een geauthenticeerde
  route-handler (`/api/exports/[exportId]`) geserveerd.
- Server Actions valideren en autoriseren server-side (nooit vertrouwen op client-side checks alleen).
- Klantgerichte exports (WhatsApp, e-mail, klant-Excel) bevatten nooit kostprijs, marge of interne
  berekeningsdetails - dat staat uitsluitend in de aparte interne Excel-export.
