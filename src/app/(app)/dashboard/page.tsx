import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [recentOffers, recentQuotes, conceptQuotes, unlinkedLines, routesWithoutRate, activeRates] =
    await Promise.all([
      prisma.farmOffer.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { farm: true, _count: { select: { lines: true } } },
      }),
      prisma.quote.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { customer: true },
      }),
      prisma.quote.count({ where: { status: "CONCEPT" } }),
      prisma.farmOfferLine.findMany({
        where: { productVariantId: null },
        take: 10,
        include: { farmOffer: { include: { farm: true } } },
      }),
      prisma.route.findMany({
        where: { freightRates: { none: {} } },
        include: { origin: true, destination: true },
      }),
      prisma.exchangeRate.findMany({ orderBy: { effectiveFrom: "desc" } }),
    ]);

  const missingWeightCount = await prisma.farmOfferLine.count({
    where: { weightPerBoxKg: null },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overzicht van openstaand werk en actuele tarieven.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Conceptoffertes" value={conceptQuotes} href="/quotes?status=CONCEPT" />
        <StatCard label="Regels zonder productkoppeling" value={unlinkedLines.length} href="/farm-offers" />
        <StatCard label="Regels zonder gewicht" value={missingWeightCount} href="/farm-offers" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Recente leveranciersaanbiedingen" href="/farm-offers">
          {recentOffers.length === 0 && <Empty />}
          <ul className="divide-y divide-gray-100">
            {recentOffers.map((o) => (
              <li key={o.id} className="py-2">
                <Link href={`/farm-offers/${o.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                  {o.title ?? o.farm?.name ?? "Naamloos"}
                </Link>
                <div className="text-xs text-gray-500">
                  {o.farm?.name} · {o._count.lines} regels · {o.status}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Recente offertes" href="/quotes">
          {recentQuotes.length === 0 && <Empty />}
          <ul className="divide-y divide-gray-100">
            {recentQuotes.map((q) => (
              <li key={q.id} className="py-2">
                <Link href={`/quotes/${q.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                  {q.quoteNumber} - {q.customer.companyName}
                </Link>
                <div className="text-xs text-gray-500">
                  {q.status} · {q.currency} · {q.incoterm}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Routes zonder vrachttarief" href="/routes">
          {routesWithoutRate.length === 0 && <Empty text="Elke route heeft een tarief." />}
          <ul className="divide-y divide-gray-100">
            {routesWithoutRate.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                {r.origin.city} → {r.destination.city}
                <span className="ml-2 text-xs text-amber-600">nog geen tarief ingesteld</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Actieve wisselkoersen" href="/exchange-rates">
          {activeRates.length === 0 && <Empty />}
          <ul className="divide-y divide-gray-100">
            {activeRates.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                1 {r.baseCurrency} = {r.rate.toString()} {r.quoteCurrency}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="card p-4 block hover:border-brand-300">
      <div className="text-3xl font-semibold text-brand-800">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </Link>
  );
}

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        <Link href={href} className="text-xs text-brand-600 hover:underline">
          Alles bekijken
        </Link>
      </div>
      {children}
    </div>
  );
}

function Empty({ text = "Nog niets om te tonen." }: { text?: string }) {
  return <p className="text-sm text-gray-400 py-2">{text}</p>;
}
