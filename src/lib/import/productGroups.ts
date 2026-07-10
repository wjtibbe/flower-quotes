/**
 * Known farm abbreviations/spellings for product groups, mapped to a
 * standardized display name. This is intentionally small and meant to grow
 * over time - product groups not in this list are simply kept as-typed
 * (title-cased) with medium confidence instead of being rejected, per
 * section 5 ("de app mag een waarschijnlijke match voorstellen, maar de
 * gebruiker moet de uiteindelijke koppeling kunnen controleren").
 */
export const PRODUCT_GROUP_ALIASES: Record<string, string> = {
  hyd: "Hydrangea",
  hydrangea: "Hydrangea",
  alstro: "Alstroemeria",
  alstroemeria: "Alstroemeria",
  ruscus: "Ruscus",
  solidago: "Solidago",
  chrysantemums: "Chrysanthemum",
  chrysanthemums: "Chrysanthemum",
  chrysanthemum: "Chrysanthemum",
  eryngium: "Eryngium",
  eucalipto: "Eucalyptus",
  eucalyptus: "Eucalyptus",
  barbatus: "Barbatus (Sweet William)",
  carnations: "Carnation",
  carnation: "Carnation",
  minicarnation: "Mini Carnation",
  "mini carnation": "Mini Carnation",
  star: "Star (Alstroemeria)",
  solomio: "Solomio (Alstroemeria)",
  rose: "Rose",
  roses: "Rose",
};

export function resolveProductGroup(raw: string): { name: string; recognized: boolean } {
  const key = raw.trim().toLowerCase();
  const known = PRODUCT_GROUP_ALIASES[key];
  if (known) return { name: known, recognized: true };
  return { name: titleCase(raw.trim()), recognized: false };
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
