import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDate } from "@/lib/format";
import ConfirmButton from "@/components/ConfirmButton";
import {
  COST_CATEGORY_LABELS,
  COST_RATE_UNIT_LABELS,
  displayAdditionalCostName,
  filterActiveCostTypes,
} from "@/lib/additionalCostTypes";
import {
  createOrigin,
  createDestination,
  createRoute,
  addFreightRate,
  deleteFreightRate,
  deleteRoute,
  toggleRouteSupportsCfr,
  toggleRouteSupportsDdp,
  addRouteCost,
  updateRouteCost,
  deleteRouteCost,
} from "./actions";

export const dynamic = "force-dynamic";

const TRANSPORT_LABELS: Record<string, string> = {
  AIR: "Luchtvracht",
  ROAD: "Wegtransport",
  LOCAL_DELIVERY: "Lokale bezorging",
  SEA: "Zeevracht",
};
// Covers both FreightRateUnit (PER_KG/PER_BOX/PER_STEM) and CostRateUnit
// (adds FLAT) - one shared Dutch label map, see additionalCostTypes.ts.
const UNIT_LABELS: Record<string, string> = COST_RATE_UNIT_LABELS;
const CATEGORY_LABELS: Record<string, string> = COST_CATEGORY_LABELS;

/** The additional cost that pricing would use now: valid, newest per (category,name). */
function currentCosts<
  T extends { id: string; effectiveFrom: Date; effectiveTo: Date | null; category: string | null; name: string | null },
>(costs: T[]): Set<string> {
  const now = new Date();
  const chosen = new Map<string, string>();
  for (const c of [...costs].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())) {
    if (!c.category || c.effectiveFrom > now || (c.effectiveTo && c.effectiveTo < now)) continue;
    const key = `${c.category}::${(c.name ?? "").toLowerCase()}`;
    if (!chosen.has(key)) chosen.set(key, c.id);
  }
  return new Set(chosen.values());
}

interface Params {
  from?: string; // vertrekstad
  to?: string; // bestemmingsstad
  fromCountry?: string;
  toCountry?: string;
  transport?: string;
  currency?: string;
  q?: string;
  sort?: string;
  dir?: string;
  msg?: string;
  err?: string;
  // The DdpCostRate id currently shown as an inline edit row (compact -
  // replaces just that one row within the route's own expanded section,
  // never a separate page/modal, so the route context is never lost).
  editCost?: string;
}

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  "origin-created": { text: "Vertreklocatie aangemaakt.", ok: true },
  "origin-exists": { text: "Deze vertreklocatie bestaat al (stad + land) - geen duplicaat aangemaakt.", ok: false },
  "destination-created": { text: "Bestemming aangemaakt.", ok: true },
  "destination-exists": { text: "Deze bestemming bestaat al (stad + land) - geen duplicaat aangemaakt.", ok: false },
  "route-created": { text: "Route aangemaakt.", ok: true },
  "route-exists": { text: "Deze route (vertrek + bestemming + transporttype) bestaat al.", ok: false },
  "cost-updated": { text: "Aanvullende kost bijgewerkt.", ok: true },
};

/** The rate pricing would use right now: within validity, newest effectiveFrom. */
function currentRate<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(rates: T[]): T | undefined {
  const now = new Date();
  return rates
    .filter((r) => r.effectiveFrom <= now && (!r.effectiveTo || r.effectiveTo >= now))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}

// Shared column layout for the header row and every route summary row (Task
// 5A/5C) - a CSS grid, not an HTML <table>, so the expanded detail panel
// (Task 5B) can sit in normal full-width document flow BELOW a row instead
// of being forced into a table cell - the root cause of the old far-right
// panel forcing horizontal scroll.
const ROW_GRID = "grid grid-cols-[1.4fr_1.4fr_1fr_1fr_0.8fr_1fr_1.25rem] gap-3 items-center";

export default async function RoutesPage({ searchParams }: { searchParams: Params }) {
  const [routes, origins, destinations, costTypes] = await Promise.all([
    prisma.route.findMany({
      include: {
        origin: true,
        destination: true,
        freightRates: { orderBy: { effectiveFrom: "desc" } },
        ddpCostRates: { orderBy: [{ category: "asc" }, { effectiveFrom: "desc" }], include: { additionalCostType: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.origin.findMany({ orderBy: { city: "asc" } }),
    prisma.destination.findMany({ orderBy: { city: "asc" } }),
    prisma.additionalCostType.findMany({ orderBy: { name: "asc" } }),
  ]);
  // The add form only ever offers active types ("Kostensoort" dropdown) -
  // inactive ones stay usable for historical rows but can't be picked again.
  const activeCostTypes = filterActiveCostTypes(costTypes);

  const ci = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();
  const contains = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase().includes(b.toLowerCase());

  let rows = routes
    .map((r) => ({ route: r, rate: currentRate(r.freightRates) }))
    .filter(({ route, rate }) => {
      if (searchParams.from && !ci(route.origin.city, searchParams.from)) return false;
      if (searchParams.to && !ci(route.destination.city, searchParams.to)) return false;
      if (searchParams.fromCountry && !ci(route.origin.country, searchParams.fromCountry)) return false;
      if (searchParams.toCountry && !ci(route.destination.country, searchParams.toCountry)) return false;
      if (searchParams.transport && route.transportType !== searchParams.transport) return false;
      if (searchParams.currency && rate?.currency !== searchParams.currency) return false;
      if (searchParams.q) {
        const target = [
          route.origin.city,
          route.origin.country,
          route.origin.code,
          route.destination.city,
          route.destination.country,
          route.destination.code,
          TRANSPORT_LABELS[route.transportType],
          rate?.currency,
        ]
          .filter(Boolean)
          .join(" ");
        if (!contains(target, searchParams.q)) return false;
      }
      return true;
    });

  const sortKey = searchParams.sort ?? "from";
  const dir = searchParams.dir === "desc" ? -1 : 1;
  const sortVal = (x: (typeof rows)[number]): string | number => {
    switch (sortKey) {
      case "to": return x.route.destination.city;
      case "fromCountry": return x.route.origin.country;
      case "toCountry": return x.route.destination.country;
      case "transport": return TRANSPORT_LABELS[x.route.transportType];
      case "currency": return x.rate?.currency ?? "";
      case "rate": return x.rate ? Number(x.rate.ratePerKg) : -1;
      case "unit": return x.rate ? UNIT_LABELS[x.rate.rateUnit] : "";
      case "effectiveFrom": return x.rate ? x.rate.effectiveFrom.getTime() : 0;
      default: return x.route.origin.city;
    }
  };
  rows = rows.sort((a, b) => {
    const va = sortVal(a);
    const vb = sortVal(b);
    return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
  });

  const cityOptions = (list: { city: string }[]) => [...new Set(list.map((x) => x.city))].sort();
  const countryOptions = (list: { country: string }[]) => [...new Set(list.map((x) => x.country))].sort();
  const currencyOptions = [...new Set(routes.flatMap((r) => r.freightRates.map((fr) => fr.currency)))].sort();
  const hasFilters = !!(searchParams.from || searchParams.to || searchParams.fromCountry || searchParams.toCountry || searchParams.transport || searchParams.currency || searchParams.q);

  const sortLink = (key: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "sort" && k !== "dir" && k !== "msg") p.set(k, v);
    p.set("sort", key);
    if (sortKey === key && dir === 1) p.set("dir", "desc");
    return `/routes?${p.toString()}`;
  };
  /** Current URL with the given keys overridden (or removed, when value is undefined) - used for the ?editCost= inline-edit toggle so it preserves filters/sort/route context. */
  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "msg" && k !== "err") p.set(k, v);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) p.delete(k);
      else p.set(k, v);
    }
    return `/routes?${p.toString()}`;
  };
  const Th = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <Link href={sortLink(k)} className="hover:underline text-xs font-semibold text-gray-600">
      {children}
      {sortKey === k ? (dir === 1 ? " ↑" : " ↓") : ""}
    </Link>
  );

  const msg = searchParams.msg ? MESSAGES[searchParams.msg] : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Routes & vracht</h1>
        <p className="text-sm text-gray-500 mt-1">
          Herbruikbare locaties, routes per transporttype en één of meer vrachttarieven per route. Het tarief dat nu
          geldig is (ingangsdatum bereikt, niet verlopen, actief) wordt gebruikt voor nieuwe offertes. Klik op een
          route voor tariefgeschiedenis, instellingen en aanvullende kosten.
        </p>
      </div>

      {msg && (
        <div className={`card p-3 text-sm ${msg.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          {msg.text}
        </div>
      )}
      {searchParams.err && (
        <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-800">{searchParams.err}</div>
      )}

      <form className="card p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Vertrekstad</label>
          <select name="from" defaultValue={searchParams.from ?? ""} className="input py-1">
            <option value="">Alle</option>
            {cityOptions(origins).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Bestemmingsstad</label>
          <select name="to" defaultValue={searchParams.to ?? ""} className="input py-1">
            <option value="">Alle</option>
            {cityOptions(destinations).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Vertrekland</label>
          <select name="fromCountry" defaultValue={searchParams.fromCountry ?? ""} className="input py-1">
            <option value="">Alle</option>
            {countryOptions(origins).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Bestemmingsland</label>
          <select name="toCountry" defaultValue={searchParams.toCountry ?? ""} className="input py-1">
            <option value="">Alle</option>
            {countryOptions(destinations).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Transporttype</label>
          <select name="transport" defaultValue={searchParams.transport ?? ""} className="input py-1">
            <option value="">Alle</option>
            {Object.entries(TRANSPORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Valuta</label>
          <select name="currency" defaultValue={searchParams.currency ?? ""} className="input py-1 w-20">
            <option value="">Alle</option>
            {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-36">
          <label className="label">Zoeken</label>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Vrij zoeken..." className="input py-1" />
        </div>
        <button className="btn-secondary">Filteren</button>
        {hasFilters && (
          <Link href="/routes" className="text-xs text-brand-600 hover:underline pb-2">
            Filters wissen
          </Link>
        )}
      </form>

      {/* CSS-grid list, not a <table> (Task 5A/5C): every route is a <details>
          block in normal document flow, so its expanded content (Task 5B)
          renders full-width BELOW the row - never squeezed into a
          far-right table cell that forces horizontal scroll. `name` groups
          every <details> into one native, JS-free accordion (Task 5C: only
          one route expanded at a time). */}
      <div className="card overflow-hidden">
        <div className={`${ROW_GRID} px-4 py-2 bg-gray-50 border-b border-gray-200`}>
          <Th k="from">Vertrek</Th>
          <Th k="to">Bestemming</Th>
          <Th k="transport">Transport</Th>
          <Th k="rate">Tarief</Th>
          <Th k="unit">Eenheid</Th>
          <Th k="effectiveFrom">Ingangsdatum</Th>
          <span />
        </div>

        {rows.map(({ route, rate }) => {
          const activeCostIds = currentCosts(route.ddpCostRates);
          return (
            <details key={route.id} name="route-expand" className="group border-b border-gray-100 last:border-b-0">
              <summary
                className={`${ROW_GRID} px-4 py-2 text-sm cursor-pointer list-none hover:bg-gray-50 [&::-webkit-details-marker]:hidden`}
              >
                <span className="font-medium text-gray-900">
                  {route.origin.city}
                  <span className="block text-xs text-gray-400 font-normal">{route.origin.country}</span>
                </span>
                <span className="font-medium text-gray-900">
                  {route.destination.city}
                  <span className="block text-xs text-gray-400 font-normal">{route.destination.country}</span>
                </span>
                <span>{TRANSPORT_LABELS[route.transportType]}</span>
                <span>
                  {rate ? (
                    <>
                      {rate.currency} {fmtMoney(rate.ratePerKg, 4)}
                    </>
                  ) : (
                    <span className="text-red-500">geen tarief</span>
                  )}
                </span>
                <span className="text-gray-500">{rate ? UNIT_LABELS[rate.rateUnit] : "-"}</span>
                <span className="text-gray-500">{rate ? fmtDate(rate.effectiveFrom) : "-"}</span>
                <span className="text-gray-400 transition-transform group-open:rotate-90 justify-self-end">›</span>
              </summary>

              <div className="px-4 pb-4 pt-1 bg-gray-50 space-y-4">
                <div>
                  <div className="font-medium text-gray-700 text-sm mb-1.5">Tariefgeschiedenis</div>
                  <div className="card overflow-x-auto">
                    <table className="table-compact">
                      <thead>
                        <tr>
                          <th>Tarief</th>
                          <th>Eenheid</th>
                          <th>Geldig van</th>
                          <th>Geldig tot</th>
                          <th></th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {route.freightRates.map((fr) => (
                          <tr key={fr.id} className={rate?.id === fr.id ? "font-semibold" : ""}>
                            <td>{fr.currency} {fmtMoney(fr.ratePerKg, 4)}</td>
                            <td>{UNIT_LABELS[fr.rateUnit]}</td>
                            <td>{fmtDate(fr.effectiveFrom)}</td>
                            <td>{fr.effectiveTo ? fmtDate(fr.effectiveTo) : "-"}</td>
                            <td>{rate?.id === fr.id && <span className="badge-high">in gebruik</span>}</td>
                            <td>
                              <form action={deleteFreightRate.bind(null, fr.id)}>
                                <ConfirmButton
                                  message="Weet je zeker dat je dit tarief wilt verwijderen? Dit kan niet ongedaan worden gemaakt."
                                  className="text-xs text-red-600 hover:underline"
                                >
                                  Verwijderen
                                </ConfirmButton>
                              </form>
                            </td>
                          </tr>
                        ))}
                        {route.freightRates.length === 0 && (
                          <tr><td colSpan={6} className="text-gray-400">Nog geen tarieven.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <form action={addFreightRate.bind(null, route.id)} className="flex flex-wrap gap-2 items-end">
                  <div>
                    <label className="label">Nieuw tarief</label>
                    <input name="ratePerKg" type="number" step="0.0001" required className="input py-1 px-2 text-xs w-24" />
                  </div>
                  <div>
                    <label className="label">Valuta</label>
                    <select name="currency" className="input py-1 px-2 text-xs w-20" defaultValue={rate?.currency ?? "USD"}>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Eenheid</label>
                    <select name="rateUnit" className="input py-1 px-2 text-xs" defaultValue="PER_KG">
                      {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Geldig vanaf</label>
                    <input name="effectiveFrom" type="date" className="input py-1 px-2 text-xs" />
                  </div>
                  <div>
                    <label className="label">Geldig tot</label>
                    <input name="effectiveTo" type="date" className="input py-1 px-2 text-xs" />
                  </div>
                  <button className="btn-primary py-1 px-2 text-xs">Tarief toevoegen</button>
                </form>

                <div className="flex items-center gap-3 pt-3 border-t border-gray-200 text-sm">
                  <span className="badge bg-gray-100 text-gray-700">FOB altijd beschikbaar</span>
                  <form action={toggleRouteSupportsCfr.bind(null, route.id, route.supportsCfr)}>
                    <button className={route.supportsCfr ? "badge-high" : "badge bg-gray-100 text-gray-500"}>
                      C&F: {route.supportsCfr ? "aan" : "uit"}
                    </button>
                  </form>
                  <form action={toggleRouteSupportsDdp.bind(null, route.id, route.supportsDdp)}>
                    <button className={route.supportsDdp ? "badge-high" : "badge bg-gray-100 text-gray-500"}>
                      DDP: {route.supportsDdp ? "aan" : "uit"}
                    </button>
                  </form>
                  <form action={deleteRoute.bind(null, route.id)} className="ml-auto">
                    <ConfirmButton
                      message={`Weet je zeker dat je de route ${route.origin.city} → ${route.destination.city} wilt verwijderen? Alle tarieven en aanvullende kosten van deze route worden ook verwijderd. Dit kan niet ongedaan worden gemaakt.`}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Route verwijderen
                    </ConfirmButton>
                  </form>
                </div>

                <div className="pt-3 border-t border-gray-200 space-y-2">
                  <div className="font-medium text-gray-700 text-sm">Aanvullende kosten (DDP)</div>
                  <div className="card overflow-x-auto">
                    <table className="table-compact">
                      <thead>
                        <tr>
                          <th>Naam</th>
                          <th>Categorie</th>
                          <th>Bedrag</th>
                          <th>Eenheid</th>
                          <th>Geldig van</th>
                          <th>Geldig tot</th>
                          <th></th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {route.ddpCostRates.map((c) => {
                          if (searchParams.editCost === c.id) {
                            // The row's own type may since have been deactivated - still offer it
                            // (plus all other active types) so editing doesn't force a type change.
                            const editOptions = c.additionalCostType && !c.additionalCostType.isActive
                              ? [c.additionalCostType, ...activeCostTypes]
                              : activeCostTypes;
                            return (
                              <tr key={c.id}>
                                <td colSpan={8}>
                                  <form
                                    action={updateRouteCost.bind(null, c.id)}
                                    className="flex flex-wrap gap-2 items-end py-1"
                                  >
                                    <div>
                                      <label className="label">Kostensoort</label>
                                      <select
                                        name="additionalCostTypeId"
                                        required
                                        className="input py-1 px-2 text-xs"
                                        defaultValue={c.additionalCostTypeId ?? ""}
                                      >
                                        {editOptions.map((t) => (
                                          <option key={t.id} value={t.id}>
                                            {t.name} ({CATEGORY_LABELS[t.category]} · {UNIT_LABELS[t.defaultUnit]})
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="label">Bedrag</label>
                                      <input
                                        name="amount"
                                        type="number"
                                        step="0.0001"
                                        required
                                        defaultValue={c.amount.toString()}
                                        className="input py-1 px-2 text-xs w-24"
                                      />
                                    </div>
                                    <div>
                                      <label className="label">Valuta</label>
                                      <select name="currency" className="input py-1 px-2 text-xs w-20" defaultValue={c.currency}>
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="label">Eenheid</label>
                                      <select name="rateUnit" className="input py-1 px-2 text-xs" defaultValue={c.rateUnit ?? ""}>
                                        {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="label">Geldig vanaf</label>
                                      <input
                                        name="effectiveFrom"
                                        type="date"
                                        defaultValue={c.effectiveFrom.toISOString().slice(0, 10)}
                                        className="input py-1 px-2 text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="label">Geldig tot</label>
                                      <input
                                        name="effectiveTo"
                                        type="date"
                                        defaultValue={c.effectiveTo ? c.effectiveTo.toISOString().slice(0, 10) : ""}
                                        className="input py-1 px-2 text-xs"
                                      />
                                    </div>
                                    <button className="btn-primary py-1 px-2 text-xs">Opslaan</button>
                                    <Link href={buildUrl({ editCost: undefined })} className="text-xs text-gray-500 hover:underline px-2">
                                      Annuleren
                                    </Link>
                                  </form>
                                </td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={c.id} className={activeCostIds.has(c.id) ? "font-semibold" : ""}>
                              <td>{displayAdditionalCostName(c)}</td>
                              <td>{c.category ? CATEGORY_LABELS[c.category] : "-"}</td>
                              <td>{c.currency} {fmtMoney(c.amount, 4)}</td>
                              <td>{c.rateUnit ? UNIT_LABELS[c.rateUnit] : "-"}</td>
                              <td>{fmtDate(c.effectiveFrom)}</td>
                              <td>{c.effectiveTo ? fmtDate(c.effectiveTo) : "-"}</td>
                              <td>{activeCostIds.has(c.id) && <span className="badge-high">in gebruik</span>}</td>
                              <td className="whitespace-nowrap">
                                <Link href={buildUrl({ editCost: c.id })} className="text-xs text-blue-600 hover:underline mr-2">
                                  Bewerken
                                </Link>
                                <form action={deleteRouteCost.bind(null, c.id)} className="inline">
                                  <ConfirmButton
                                    message="Weet je zeker dat je deze aanvullende kost wilt verwijderen? Dit kan niet ongedaan worden gemaakt."
                                    className="text-xs text-red-600 hover:underline"
                                  >
                                    Verwijderen
                                  </ConfirmButton>
                                </form>
                              </td>
                            </tr>
                          );
                        })}
                        {route.ddpCostRates.length === 0 && (
                          <tr><td colSpan={8} className="text-gray-400">Nog geen aanvullende kosten.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <form action={addRouteCost.bind(null, route.id)} className="flex flex-wrap gap-2 items-end">
                    <div>
                      <label className="label">Kostensoort</label>
                      <select name="additionalCostTypeId" required className="input py-1 px-2 text-xs">
                        <option value="">Kies een kostensoort...</option>
                        {activeCostTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({CATEGORY_LABELS[t.category]} · {UNIT_LABELS[t.defaultUnit]})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Bedrag</label>
                      <input name="amount" type="number" step="0.0001" required className="input py-1 px-2 text-xs w-24" />
                    </div>
                    <div>
                      <label className="label">Valuta</label>
                      <select name="currency" className="input py-1 px-2 text-xs w-20" defaultValue="USD">
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Eenheid</label>
                      <select name="rateUnit" className="input py-1 px-2 text-xs" defaultValue="PER_STEM">
                        {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Geldig vanaf</label>
                      <input name="effectiveFrom" type="date" className="input py-1 px-2 text-xs" />
                    </div>
                    <div>
                      <label className="label">Geldig tot</label>
                      <input name="effectiveTo" type="date" className="input py-1 px-2 text-xs" />
                    </div>
                    <button className="btn-primary py-1 px-2 text-xs">Kosten toevoegen</button>
                  </form>
                  <div className="text-xs">
                    <Link href="/settings" className="text-gray-500 hover:underline">
                      Nieuwe kostensoort beheren →
                    </Link>
                  </div>
                </div>
              </div>
            </details>
          );
        })}

        {rows.length === 0 && (
          <div className="text-center text-gray-400 py-8 text-sm">
            Geen routes gevonden{hasFilters ? " met deze filters" : ""}.{" "}
            {hasFilters ? (
              <Link href="/routes" className="text-brand-600 hover:underline">Filters wissen</Link>
            ) : (
              "Maak hieronder eerst locaties en een route aan."
            )}
          </div>
        )}
      </div>

      <details className="card p-4">
        <summary className="font-semibold text-gray-800 cursor-pointer text-sm">
          Locatie of route toevoegen
        </summary>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
          <div>
            <h2 className="font-semibold text-gray-800 mb-3 text-sm">Nieuwe vertreklocatie</h2>
            <form action={createOrigin} className="space-y-3">
              <div>
                <label className="label">Stad *</label>
                <input className="input" name="city" required />
              </div>
              <div>
                <label className="label">Land *</label>
                <input className="input" name="country" required />
              </div>
              <div>
                <label className="label">Luchthaven of locatie</label>
                <input className="input" name="locationName" />
              </div>
              <div>
                <label className="label">IATA-/locatiecode</label>
                <input className="input" name="code" placeholder="bv. UIO" />
              </div>
              <button className="btn-primary" type="submit">Vertreklocatie toevoegen</button>
            </form>
          </div>

          <div>
            <h2 className="font-semibold text-gray-800 mb-3 text-sm">Nieuwe bestemming</h2>
            <form action={createDestination} className="space-y-3">
              <div>
                <label className="label">Stad *</label>
                <input className="input" name="city" required />
              </div>
              <div>
                <label className="label">Land *</label>
                <input className="input" name="country" required />
              </div>
              <div>
                <label className="label">Luchthaven of locatie</label>
                <input className="input" name="locationName" />
              </div>
              <div>
                <label className="label">IATA-/locatiecode</label>
                <input className="input" name="code" placeholder="bv. DXB" />
              </div>
              <button className="btn-primary" type="submit">Bestemming toevoegen</button>
            </form>
          </div>

          <div>
            <h2 className="font-semibold text-gray-800 mb-3 text-sm">Nieuwe route</h2>
            <form action={createRoute} className="space-y-3">
              <div>
                <label className="label">Vertrekpunt *</label>
                <select className="input" name="originId" required defaultValue="">
                  <option value="" disabled>Kies...</option>
                  {origins.map((o) => (
                    <option key={o.id} value={o.id}>{o.city} ({o.country})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Bestemming *</label>
                <select className="input" name="destinationId" required defaultValue="">
                  <option value="" disabled>Kies...</option>
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>{d.city} ({d.country})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Transporttype</label>
                <select className="input" name="transportType" defaultValue="AIR">
                  {Object.entries(TRANSPORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <button className="btn-primary" type="submit">Route toevoegen</button>
            </form>
          </div>
        </div>
      </details>
    </div>
  );
}
