"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const SECTIONS: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/farm-offers", label: "Leveranciersaanbiedingen" },
  { href: "/quotes", label: "Offertes" },
  { href: "/products", label: "Assortiment" },
  { href: "/farms", label: "Leveranciers" },
  { href: "/routes", label: "Routes & vracht" },
  { href: "/ddp-costs", label: "DDP-kosten" },
  { href: "/customers", label: "Klanten" },
  { href: "/exchange-rates", label: "Wisselkoersen" },
  { href: "/settings", label: "Instellingen" },
];

export default function Nav({ userName }: { userName: string }) {
  const pathname = usePathname();

  return (
    <nav className="w-64 shrink-0 bg-brand-900 text-brand-50 flex flex-col">
      <div className="px-4 py-5 border-b border-brand-800">
        <div className="font-semibold text-lg">Flower Quotes</div>
        <div className="text-xs text-brand-300 mt-0.5">{userName}</div>
      </div>
      <ul className="flex-1 overflow-y-auto py-2">
        {SECTIONS.map((s) => {
          const active = pathname === s.href || pathname.startsWith(s.href + "/");
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                className={`block px-4 py-2 text-sm ${
                  active ? "bg-brand-700 text-white" : "text-brand-100 hover:bg-brand-800"
                }`}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-3 border-t border-brand-800">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-sm text-brand-200 hover:text-white"
        >
          Uitloggen
        </button>
      </div>
    </nav>
  );
}
