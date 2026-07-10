import type { Decimal } from "@prisma/client/runtime/library";

export function fmtMoney(value: Decimal | string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "-";
  const n = typeof value === "object" ? Number(value.toString()) : Number(value);
  if (Number.isNaN(n)) return "-";
  return n.toLocaleString("nl-NL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("nl-NL");
}

export function fmtDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("nl-NL");
}
