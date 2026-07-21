import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import ConfirmButton from "@/components/ConfirmButton";
import { addExchangeRate, editExchangeRate, deleteExchangeRate } from "./actions";

export const dynamic = "force-dynamic";

interface Params {
  q?: string;
  base?: string;
  quote?: string;
  edit?: string;
  msg?: string;
}

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  "rate-added": { text: "Nieuwe wisselkoers ingesteld.", ok: true },
  "rate-updated": { text: "Wisselkoers bijgewerkt.", ok: true },
  "rate-deleted": { text: "Wisselkoers verwijderd.", ok: true },
};

export default async function ExchangeRatesPage({ searchParams }: { searchParams: Params }) {
  const rates = await prisma.exchangeRate.findMany({
    include: { updatedBy: { select: { name: true } } },
    orderBy: [{ baseCurrency: "asc" }, { quoteCurrency: "asc" }, { effectiveFrom: "desc" }],
  });

  const contains = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase().includes(b.toLowerCase());

  const rows = rates.filter((r) => {
    if (searchParams.base && r.baseCurrency !== searchParams.base) return false;
    if (searchParams.quote && r.quoteCurrency !== searchParams.quote) return false;
    if (searchParams.q) {
      const target = [r.baseCurrency, r.quoteCurrency, r.rate.toString(), r.notes, r.updatedBy?.name]
        .filter(Boolean)
        .join(" ");
      if (!contains(target, searchParams.q)) return false;
    }
    return true;
  });

  const editing = searchParams.edit ? rates.find((r) => r.id === searchParams.edit) : null;
  const currencyOptions = [...new Set(rates.flatMap((r) => [r.baseCurrency, r.quoteCurrency]))].sort();
  const hasFilters = !!(searchParams.q || searchParams.base || searchParams.quote);
  const msg = searchParams.msg ? MESSAGES[searchParams.msg] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Wisselkoersen</h1>
        <p className="text-sm text-gray-500 mt-1">
          Handmatig beheerde koersen. Elke offerte legt bij calculatie een eigen snapshot vast - latere wijzigingen
          hier veranderen bestaande offertes nooit.
        </p>
      </div>

      {msg && (
        <div className={`card p-3 text-sm ${msg.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          {msg.text}
        </div>
      )}

      <form className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Bronvaluta</label>
          <select name="base" defaultValue={searchParams.base ?? ""} className="input py-1 w-24">
            <option value="">Alle</option>
            {currencyOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Doelvaluta</label>
          <select name="quote" defaultValue={searchParams.quote ?? ""} className="input py-1 w-24">
            <option value="">Alle</option>
            {currencyOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-40">
          <label className="label">Zoeken</label>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Valuta, koers, notitie..." className="input py-1" />
        </div>
        <button className="btn-secondary">Filteren</button>
        {hasFilters && (
          <Link href="/exchange-rates" className="text-xs text-brand-600 hover:underline pb-2">
            Filters wissen
          </Link>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Bronvaluta</th>
              <th>Doelvaluta</th>
              <th>Actuele koers</th>
              <th>Laatst gewijzigd</th>
              <th>Gewijzigd door</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.baseCurrency}</td>
                <td>{r.quoteCurrency}</td>
                <td>
                  1 {r.baseCurrency} = {fmtMoney(r.rate, 6)} {r.quoteCurrency}
                </td>
                <td>{fmtDateTime(r.updatedAt)}</td>
                <td>{r.updatedBy?.name ?? "-"}</td>
                <td className="whitespace-nowrap">
                  <a href={`/exchange-rates?edit=${r.id}`} className="text-brand-600 hover:underline text-xs mr-3">
                    Aanpassen
                  </a>
                  <form action={deleteExchangeRate.bind(null, r.id)} className="inline">
                    <ConfirmButton
                      message={`Weet je zeker dat je de koers 1 ${r.baseCurrency} = ${fmtMoney(r.rate, 6)} ${r.quoteCurrency} wilt verwijderen? Bestaande offertes blijven ongewijzigd. Dit kan niet ongedaan worden gemaakt.`}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Verwijderen
                    </ConfirmButton>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-6">
                  {rates.length === 0
                    ? "Nog geen wisselkoersen ingevoerd."
                    : "Geen wisselkoersen gevonden met deze filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-6 max-w-lg">
        <h2 className="font-semibold text-gray-800 mb-4">{editing ? "Koers aanpassen" : "Nieuwe koers instellen"}</h2>
        {editing ? (
          <form action={editExchangeRate.bind(null, editing.id)} key={editing.id} className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Basisvaluta</label>
              <input className="input bg-gray-50" value={editing.baseCurrency} disabled readOnly />
            </div>
            <div>
              <label className="label">Doelvaluta</label>
              <input className="input bg-gray-50" value={editing.quoteCurrency} disabled readOnly />
            </div>
            <div className="col-span-2">
              <label className="label">Koers (1 {editing.baseCurrency} = ... {editing.quoteCurrency}) *</label>
              <input className="input" name="rate" type="number" step="0.000001" min="0" required defaultValue={editing.rate.toString()} />
            </div>
            <div className="col-span-2">
              <label className="label">Opmerkingen</label>
              <textarea className="input" name="notes" rows={2} defaultValue={editing.notes ?? ""} />
            </div>
            <div className="col-span-2 flex gap-2">
              <button className="btn-primary" type="submit">Opslaan</button>
              <a href="/exchange-rates" className="btn-secondary">Annuleren</a>
            </div>
          </form>
        ) : (
          <form action={addExchangeRate} className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Basisvaluta *</label>
              <select className="input" name="baseCurrency" required defaultValue="USD">
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="label">Doelvaluta *</label>
              <select className="input" name="quoteCurrency" required defaultValue="EUR">
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">Koers (1 basis = ... doel) *</label>
              <input className="input" name="rate" type="number" step="0.000001" min="0" required placeholder="0.920000" />
            </div>
            <div className="col-span-2">
              <label className="label">Opmerkingen</label>
              <textarea className="input" name="notes" rows={2} />
            </div>
            <div className="col-span-2">
              <button className="btn-primary" type="submit">Koers instellen</button>
            </div>
          </form>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Een nieuwe koers voor hetzelfde valutapaar vervangt automatisch de vorige.
        </p>
      </div>
    </div>
  );
}
