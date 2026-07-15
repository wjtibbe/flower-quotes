import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDate } from "@/lib/format";
import {
  createOrigin,
  createDestination,
  createRoute,
  addFreightRate,
  toggleFreightRateActive,
  toggleRouteActive,
  toggleRouteSupportsCfr,
  toggleRouteSupportsDdp,
} from "./actions";

export const dynamic = "force-dynamic";

const TRANSPORT_LABELS: Record<string, string> = {
  AIR: "Luchtvracht",
  ROAD: "Wegtransport",
  LOCAL_DELIVERY: "Lokale bezorging",
  SEA: "Zeevracht",
};
const UNIT_LABELS: Record<string, string> = {
  PER_KG: "per kg",
  PER_BOX: "per doos",
  PER_STEM: "per steel",
};

interface Params {
  from?: string; // vertrekstad
  to?: string; // bestemmingsstad
  fromCountry?: string;
  toCountry?: string;
  transport?: string;
  currency?: string;
  status?: string;
  q?: string;
  sort?: string;
  dir?: string;
  msg?: string;
}

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  "origin-created": { text: "Vertreklocatie aangemaakt.", ok: true },
  "origin-exists": { text: "Deze vertreklocatie bestaat al (stad + land) - geen duplicaat aangemaakt.", ok: false },
  "destination-created": { text: "Bestemming aangemaakt.", ok: true },
  "destination-exists": { text: "Deze bestemming bestaat al (stad + land) - geen duplicaat aangemaakt.", ok: false },
  "route-created": { text: "Route aangemaakt.", ok: true },
  "route-exists": { text: "Deze route (vertrek + bestemming + transporttype) bestaat al.", ok: false },
};

/** The rate pricing would use right now: active, within validity, newest effectiveFrom. */
function currentRate<T extends { active: boolean; effectiveFrom: Date; effectiveTo: Date | null }>(rates: T[]): T | undefined {
  const now = new Date();
  return rates
    .filter((r) => r.active && r.effectiveFrom <= now && (!r.effectiveTo || r.effectiveTo >= now))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}

export default async function RoutesPage({ searchParams }: { searchParams: Params }) {
  const [routes, origins, destinations] = await Promise.all([
    prisma.route.findMany({
      include: { origin: true, destination: true, freightRates: { orderBy: { effectiveFrom: "desc" } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.origin.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
    prisma.destination.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
  ]);

  const status = searchParams.status ?? "active";
  const ci = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();
  const contains = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase().includes(b.toLowerCase());

  let rows = routes
    .map((r) => ({ route: r, rate: currentRate(r.freightRates) }))
    .filter(({ route, rate }) => {
      if (status === "active" && !route.active) return false;
      if (status === "inactive" && route.active) return false;
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
  const hasFilters = !!(searchParams.from || searchParams.to || searchParams.fromCountry || searchParams.toCountry || searchParams.transport || searchParams.currency || searchParams.q || (searchParams.status && searchParams.status !== "active"));

  const sortLink = (key: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "sort" && k !== "dir" && k !== "msg") p.set(k, v);
    p.set("sort", key);
    if (sortKey === key && dir === 1) p.set("dir", "desc");
    return `/routes?${p.toString()}`;
  };
  const Th = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <th>
      <Link href={sortLink(k)} className="hover:underline">
        {children}
        {sortKey === k ? (dir === 1 ? " ↑" : " ↓") : ""}
      </Link>
    </th>
  );

  const msg = searchParams.msg ? MESSAGES[searchParams.msg] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Routes & vracht</h1>
        <p className="text-sm text-gray-500 mt-1">
          Herbruikbare locaties, routes per transporttype en één of meer vrachttarieven per route. Het tarief dat nu
          geldig is (ingangsdatum bereikt, niet verlopen, actief) wordt gebruikt voor nieuwe offertes.
        </p>
      </div>

      {msg && (
        <div className={`card p-3 text-sm ${msg.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          {msg.text}
        </div>
      )}

      <form className="card p-4 flex flex-wrap gap-3 items-end">
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
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={status} className="input py-1 w-24">
            <option value="active">Actief</option>
            <option value="inactive">Inactief</option>
            <option value="all">Alle</option>
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

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <Th k="from">Vertrek</Th>
              <Th k="fromCountry">Vertrekland</Th>
              <Th k="to">Bestemming</Th>
              <Th k="toCountry">Bestemmingsland</Th>
              <Th k="transport">Transport</Th>
              <Th k="currency">Valuta</Th>
              <Th k="rate">Tarief</Th>
              <Th k="unit">Eenheid</Th>
              <Th k="effectiveFrom">Ingangsdatum</Th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ route, rate }) => (
              <tr key={route.id} className={route.active ? "" : "opacity-50"}>
                <td className="py-1.5 font-medium">
                  {route.origin.city}
                  {route.origin.code && <span className="ml-1 text-xs text-gray-400">{route.origin.code}</span>}
                </td>
                <td className="py-1.5">{route.origin.country}</td>
                <td className="py-1.5 font-medium">
                  {route.destination.city}
                  {route.destination.code && <span className="ml-1 text-xs text-gray-400">{route.destination.code}</span>}
                </td>
                <td className="py-1.5">{route.destination.country}</td>
                <td className="py-1.5">{TRANSPORT_LABELS[route.transportType]}</td>
                <td className="py-1.5">{rate?.currency ?? "-"}</td>
                <td className="py-1.5">{rate ? fmtMoney(rate.ratePerKg, 4) : <span className="text-red-500">geen tarief</span>}</td>
                <td className="py-1.5">{rate ? UNIT_LABELS[rate.rateUnit] : "-"}</td>
                <td className="py-1.5">{rate ? fmtDate(rate.effectiveFrom) : "-"}</td>
                <td className="py-1.5">
                  <span className={route.active ? "badge-high" : "badge-low"}>{route.active ? "actief" : "inactief"}</span>
                </td>
                <td className="py-1.5 whitespace-nowrap">
                  <details>
                    <summary className="text-xs text-brand-600 cursor-pointer">Tarieven & instellingen</summary>
                    <div className="mt-2 bg-gray-50 p-3 rounded space-y-3 min-w-96">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <th>Tarief</th>
                            <th>Eenheid</th>
                            <th>Geldig van</th>
                            <th>Geldig tot</th>
                            <th>Status</th>
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
                              <td>
                                {rate?.id === fr.id ? (
                                  <span className="badge-high">in gebruik</span>
                                ) : fr.active ? (
                                  <span className="badge bg-gray-100 text-gray-600">actief</span>
                                ) : (
                                  <span className="badge-low">inactief</span>
                                )}
                              </td>
                              <td>
                                <form action={toggleFreightRateActive.bind(null, fr.id, fr.active)}>
                                  <button className="text-xs text-gray-500 hover:underline">
                                    {fr.active ? "Deactiveren" : "Activeren"}
                                  </button>
                                </form>
                              </td>
                            </tr>
                          ))}
                          {route.freightRates.length === 0 && (
                            <tr><td colSpan={6} className="text-gray-400">Nog geen tarieven.</td></tr>
                          )}
                        </tbody>
                      </table>

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

                      <div className="flex items-center gap-3 pt-2 border-t border-gray-200 text-sm">
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
                        <form action={toggleRouteActive.bind(null, route.id, route.active)}>
                          <button className="text-xs text-gray-500 hover:underline">
                            Route {route.active ? "deactiveren" : "activeren"}
                          </button>
                        </form>
                      </div>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center text-gray-400 py-8">
                  Geen routes gevonden{hasFilters ? " met deze filters" : ""}.{" "}
                  {hasFilters ? (
                    <Link href="/routes" className="text-brand-600 hover:underline">Filters wissen</Link>
                  ) : (
                    "Maak hieronder eerst locaties en een route aan."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nieuwe vertreklocatie</h2>
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

        <div className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nieuwe bestemming</h2>
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

        <div className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nieuwe route</h2>
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
    </div>
  );
}
