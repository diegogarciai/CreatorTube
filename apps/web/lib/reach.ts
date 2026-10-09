import { trafficSourceLabel } from "@planificador/youtube";

/**
 * Alcance de las miniaturas (Fase 4 · paso 2): sumas de impresiones y CTR, y el
 * reparto por fuente de tráfico. El CTR de varios días o videos lo calcula la
 * app como clics ÷ impresiones (clics = impresiones × CTR de cada día).
 */

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

/** Impresiones de la miniatura y su CTR (de 0 a 1; null sin impresiones). */
export type ReachTotals = { impressions: number; clicks: number; ctr: number | null };

/** Suma impresiones y clics; el CTR de varios días o videos es clics ÷ impresiones. */
export function reachTotals(
  rows: readonly { impressions: number | string | null; clicks: number | string | null }[],
): ReachTotals {
  const impressions = rows.reduce((a, r) => a + n(r.impressions), 0);
  const clicks = rows.reduce((a, r) => a + n(r.clicks), 0);
  return { impressions, clicks, ctr: impressions ? clicks / impressions : null };
}

/** Una fuente de tráfico: su nombre, impresiones, parte del total y CTR. */
export type SourceRow = {
  code: string;
  label: string;
  impressions: number;
  share: number;
  ctr: number | null;
};

export function sourceRows(
  rows: readonly {
    traffic_source: string;
    impressions: number | string | null;
    clicks: number | string | null;
  }[],
): SourceRow[] {
  const total = rows.reduce((a, r) => a + n(r.impressions), 0);
  return rows
    .map((r) => ({
      code: r.traffic_source,
      label: trafficSourceLabel(r.traffic_source),
      impressions: n(r.impressions),
      share: total ? n(r.impressions) / total : 0,
      ctr: n(r.impressions) ? n(r.clicks) / n(r.impressions) : null,
    }))
    .filter((r) => r.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions);
}
