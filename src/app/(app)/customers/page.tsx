import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  saveCustomer,
  toggleCustomerActive,
  addCustomerDestination,
  setDefaultCustomerDestination,
  deactivateCustomerDestination,
} from "./actions";

export const dynamic = "force-dynamic";

interface Params {
  edit?: string;
  q?: string;
  country?: string;
  destination?: string;
  status?: string;
  sort?: string;
  dir?: string;
  msg?: string;
}

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  "destination-link-added": { text: "Bestemming aan klant gekoppeld.", ok: true },
  "destination-link-exists": { text: "Deze bestemming is al aan deze klant gekoppeld.", ok: false },
};

export default async function CustomersPage({ searchParams }: { searchParams: Params }) {
  const [customers, destinations] = await Promise.all([
    prisma.customer.findMany({
      include: {
        destination: true,
        customerDestinations: { include: { destination: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.destination.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
  ]);

  const status = searchParams.status ?? "active";
  const contains = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase().includes(b.toLowerCase());

  let rows = customers.filter((c) => {
    if (status === "active" && !c.active) return false;
    if (status === "inactive" && c.active) return false;
    if (searchParams.country && !contains(c.country, searchParams.country)) return false;
    if (searchParams.destination && c.destinationId !== searchParams.destination) return false;
    if (searchParams.q) {
      const target = [c.companyName, c.contactName, c.whatsappNumber, c.email, c.country, c.destination?.city]
        .filter(Boolean)
        .join(" ");
      if (!contains(target, searchParams.q)) return false;
    }
    return true;
  });

  const sortKey = searchParams.sort ?? "company";
  const dir = searchParams.dir === "desc" ? -1 : 1;
  const sortVal = (c: (typeof rows)[number]): string => {
    switch (sortKey) {
      case "contact": return c.contactName ?? "";
      case "country": return c.country ?? "";
      case "destination": return c.destination?.city ?? "";
      case "currency": return c.defaultCurrency;
      case "status": return c.active ? "0" : "1";
      default: return c.companyName;
    }
  };
  rows = rows.sort((a, b) => sortVal(a).localeCompare(sortVal(b)) * dir);

  const editing = searchParams.edit ? customers.find((c) => c.id === searchParams.edit) : null;
  const countryOptions = [...new Set(customers.map((c) => c.country).filter((x): x is string => !!x))].sort();
  const hasFilters = !!(searchParams.q || searchParams.country || searchParams.destination || (searchParams.status && searchParams.status !== "active"));
  const msg = searchParams.msg ? MESSAGES[searchParams.msg] : null;

  const sortLink = (key: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "sort" && k !== "dir" && k !== "msg" && k !== "edit") p.set(k, v);
    p.set("sort", key);
    if (sortKey === key && dir === 1) p.set("dir", "desc");
    return `/customers?${p.toString()}`;
  };
  const Th = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <th>
      <Link href={sortLink(k)} className="hover:underline">
        {children}
        {sortKey === k ? (dir === 1 ? " ↑" : " ↓") : ""}
      </Link>
    </th>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Klanten</h1>
        <p className="text-sm text-gray-500 mt-1">
          Klantprofielen met leverbestemming(en), valuta, incoterm en marge. Bestemmingen zijn gekoppeld aan de
          locaties uit Routes &amp; vracht.
        </p>
      </div>

      {msg && (
        <div className={`card p-3 text-sm ${msg.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          {msg.text}
        </div>
      )}

      <form className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Land</label>
          <select name="country" defaultValue={searchParams.country ?? ""} className="input py-1">
            <option value="">Alle</option>
            {countryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Bestemming</label>
          <select name="destination" defaultValue={searchParams.destination ?? ""} className="input py-1">
            <option value="">Alle</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>{d.city}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={status} className="input py-1 w-28">
            <option value="active">Actief</option>
            <option value="inactive">Inactief</option>
            <option value="all">Alle</option>
          </select>
        </div>
        <div className="flex-1 min-w-40">
          <label className="label">Zoeken</label>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Bedrijf, contact, telefoon, e-mail..." className="input py-1" />
        </div>
        <button className="btn-secondary">Filteren</button>
        {hasFilters && (
          <Link href="/customers" className="text-xs text-brand-600 hover:underline pb-2">
            Filters wissen
          </Link>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <Th k="company">Bedrijf</Th>
              <Th k="contact">Contact</Th>
              <th>Telefoon</th>
              <th>E-mail</th>
              <Th k="country">Land</Th>
              <Th k="destination">Standaardbestemming</Th>
              <Th k="currency">Valuta</Th>
              <Th k="status">Status</Th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const activeLinks = c.customerDestinations.filter((l) => l.active);
              return (
                <tr key={c.id} className={c.active ? "" : "opacity-50"}>
                  <td className="font-medium">{c.companyName}</td>
                  <td>{c.contactName ?? "-"}</td>
                  <td>{c.whatsappNumber ?? "-"}</td>
                  <td>{c.email ?? "-"}</td>
                  <td>{c.country ?? "-"}</td>
                  <td>
                    {c.destination ? (
                      c.destination.city
                    ) : (
                      <span className="text-amber-600 text-xs">Geen standaardbestemming ingesteld</span>
                    )}
                  </td>
                  <td>{c.defaultCurrency}</td>
                  <td>
                    <span className={c.active ? "badge-high" : "badge-low"}>{c.active ? "actief" : "inactief"}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <a href={`/customers?edit=${c.id}`} className="text-brand-600 hover:underline text-xs mr-3">
                      Bewerken
                    </a>
                    <details className="inline-block mr-3">
                      <summary className="text-xs text-brand-600 cursor-pointer inline">Bestemmingen ({activeLinks.length})</summary>
                      <div className="mt-2 bg-gray-50 p-2 rounded text-xs space-y-2 min-w-64">
                        {activeLinks.length === 0 && <div className="text-gray-400">Geen actieve bestemmingen.</div>}
                        {activeLinks.map((l) => (
                          <div key={l.id} className="flex items-center justify-between gap-2">
                            <span>
                              {l.destination.city}
                              {l.isDefault && <span className="ml-1 badge-high">standaard</span>}
                            </span>
                            <span className="flex gap-2">
                              {!l.isDefault && (
                                <form action={setDefaultCustomerDestination.bind(null, c.id, l.id)}>
                                  <button className="text-brand-600 hover:underline">Standaard maken</button>
                                </form>
                              )}
                              <form action={deactivateCustomerDestination.bind(null, l.id)}>
                                <button className="text-gray-500 hover:underline">Deactiveren</button>
                              </form>
                            </span>
                          </div>
                        ))}
                        <form action={addCustomerDestination.bind(null, c.id)} className="flex gap-1 pt-1 border-t border-gray-200">
                          <select name="destinationId" className="input py-1 text-xs flex-1" defaultValue="">
                            <option value="" disabled>Bestemming toevoegen...</option>
                            {destinations
                              .filter((d) => !activeLinks.some((l) => l.destinationId === d.id))
                              .map((d) => (
                                <option key={d.id} value={d.id}>{d.city}</option>
                              ))}
                          </select>
                          <button className="btn-secondary py-1 px-2 text-xs">Toevoegen</button>
                        </form>
                      </div>
                    </details>
                    <form action={toggleCustomerActive.bind(null, c.id, c.active)} className="inline">
                      <button className="text-xs text-gray-500 hover:underline">
                        {c.active ? "Deactiveren" : "Activeren"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-gray-400 py-6">
                  {customers.length === 0 ? "Nog geen klanten toegevoegd." : "Geen klanten gevonden met deze filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-6 max-w-2xl">
        <h2 className="font-semibold text-gray-800 mb-4">{editing ? "Klant bewerken" : "Nieuwe klant"}</h2>
        <form action={saveCustomer} key={editing?.id ?? "new"} className="grid grid-cols-2 gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <div className="col-span-2">
            <label className="label">Bedrijfsnaam *</label>
            <input className="input" name="companyName" required defaultValue={editing?.companyName} />
          </div>
          <div>
            <label className="label">Contactpersoon</label>
            <input className="input" name="contactName" defaultValue={editing?.contactName ?? ""} />
          </div>
          <div>
            <label className="label">Telefoonnummer</label>
            <input className="input" name="whatsappNumber" defaultValue={editing?.whatsappNumber ?? ""} />
          </div>
          <div>
            <label className="label">E-mailadres</label>
            <input className="input" type="email" name="email" defaultValue={editing?.email ?? ""} />
          </div>
          <div>
            <label className="label">Land</label>
            <input className="input" name="country" defaultValue={editing?.country ?? ""} />
          </div>
          <div className="col-span-2">
            <label className="label">Factuuradres</label>
            <input className="input" name="invoiceAddress" defaultValue={editing?.invoiceAddress ?? ""} />
          </div>
          {!editing && (
            <div>
              <label className="label">Standaard leverbestemming *</label>
              <select className="input" name="destinationId" required defaultValue="">
                <option value="" disabled>Kies bestemming...</option>
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>{d.city}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Standaardvaluta</label>
            <select className="input" name="defaultCurrency" defaultValue={editing?.defaultCurrency ?? "USD"}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className="label">Standaard-incoterm</label>
            <select className="input" name="defaultIncoterm" defaultValue={editing?.defaultIncoterm ?? "FOB"}>
              <option value="FOB">FOB</option>
              <option value="CFR">C&amp;F</option>
              <option value="DDP">DDP</option>
            </select>
          </div>
          <div>
            <label className="label">Standaardmarge (%)</label>
            <input
              className="input"
              name="defaultMarginPercent"
              type="number"
              step="0.001"
              min="0"
              defaultValue={editing?.defaultMarginPercent?.toString() ?? "15"}
            />
          </div>
          <div className="col-span-2">
            <label className="label">Opmerkingen</label>
            <textarea className="input" name="notes" rows={2} defaultValue={editing?.notes ?? ""} />
          </div>

          {editing && editing.customerDestinations.filter((l) => l.active).length === 0 && (
            <div className="col-span-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
              Geen standaardbestemming ingesteld. Voeg via "Bestemmingen" in de tabel hierboven een bestemming toe.
            </div>
          )}

          <div className="col-span-2 flex gap-2">
            <button className="btn-primary" type="submit">
              {editing ? "Opslaan" : "Klant toevoegen"}
            </button>
            {editing && (
              <a href="/customers" className="btn-secondary">
                Annuleren
              </a>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
