import { isScriptStep, stepSpec } from "@planificador/ai";

/**
 * Cuentas del panel de consumo (Administración): de qué etapa es cada registro
 * y cuánto fue IA y cuánto búsqueda. Sin acceso a la base: se prueba solo.
 */

/** Precio por búsqueda para registros de antes del panel, que no lo guardaban. */
export const SEARCH_PRICE_ESTIMATE_USD = 0.005;
/** Cuota diaria de la YouTube Data API, compartida por todos los canales. */
export const YOUTUBE_DAILY_QUOTA = 10_000;

export const USAGE_STAGES = [
  "direction",
  "study",
  "script",
  "verification",
  "publication",
  "podcast",
  "youtube_import",
  "thumbnails",
  "visual_aids",
  "render",
  "other",
] as const;
export type UsageStage = (typeof USAGE_STAGES)[number];

/** La etapa de un registro según su tipo (`direction`, `script_<paso>`…). */
export function stageOfKind(kind: string): UsageStage {
  if (kind === "direction" || kind === "youtube_import") return kind;
  if (kind.startsWith("thumbnail_")) return "thumbnails";
  if (kind === "visual_plan") return "visual_aids";
  if (kind === "render_aids") return "render";
  if (kind.startsWith("script_")) {
    const step = kind.slice("script_".length);
    if (isScriptStep(step)) return stepSpec(step).stage;
    // Pasos de corridas viejas que ya no existen.
    if (step === "reels") return "verification";
  }
  return "other";
}

export type UsageRow = {
  workspace_id: string;
  kind: string;
  model: string;
  calls: number;
  credits: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  searches: number;
  search_usd: number;
  legacy_searches: number;
  images: number;
  image_usd: number;
};

/** Cuánto de un registro fue IA (Claude), búsqueda (Parallel) e imágenes (Gemini). */
export function splitCost(
  row: Pick<UsageRow, "cost_usd" | "search_usd" | "legacy_searches"> &
    Partial<Pick<UsageRow, "image_usd">>,
) {
  const image = Math.min(row.cost_usd, row.image_usd ?? 0);
  const search = Math.min(
    row.cost_usd - image,
    row.search_usd + row.legacy_searches * SEARCH_PRICE_ESTIMATE_USD,
  );
  return { aiUsd: row.cost_usd - search - image, searchUsd: search, imageUsd: image };
}

export type BudgetState = "none" | "ok" | "warn" | "over";

/** Aviso al 80 % del presupuesto y rojo al superarlo. */
export function budgetState(spent: number, budget: number | null | undefined): BudgetState {
  if (!budget || budget <= 0) return "none";
  const ratio = spent / budget;
  if (ratio > 1) return "over";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

/** Suma por una clave. */
export function sumBy<T>(rows: readonly T[], key: (r: T) => string, value: (r: T) => number) {
  const out = new Map<string, number>();
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + value(r));
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}
