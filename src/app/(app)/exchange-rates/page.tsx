import { redirect } from "next/navigation";

/**
 * Wisselkoersen moved under Instellingen -> Wisselkoersen. This route stays
 * so any bookmarked/old link to /exchange-rates keeps working.
 */
export default function ExchangeRatesRedirect(): never {
  redirect("/settings/exchange-rates");
}
