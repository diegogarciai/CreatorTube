import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tile = {
  label: string;
  value: string;
  /** Variación contra el período anterior (−1 a ∞); null si no hay con qué comparar. */
  delta?: number | null;
};

/** Cifras de un período: valor en tinta de texto y la variación con ícono y color. */
export function StatTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="stat-tiles">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-border bg-surface px-4 py-3">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd className="mt-1 text-xl font-semibold">{t.value}</dd>
          {t.delta !== undefined && t.delta !== null && Number.isFinite(t.delta) ? (
            <dd
              className={cn(
                "mt-0.5 flex items-center gap-0.5 text-xs whitespace-nowrap",
                Math.round(t.delta * 100) === 0
                  ? "text-muted"
                  : t.delta > 0
                    ? "text-ok"
                    : "text-critical",
              )}
            >
              {Math.round(t.delta * 100) === 0 ? (
                <Minus className="size-3.5" aria-hidden />
              ) : t.delta > 0 ? (
                <ArrowUpRight className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownRight className="size-3.5" aria-hidden />
              )}
              {Math.round(t.delta * 100) === 0
                ? "0 %"
                : `${t.delta > 0 ? "+" : "−"}${Math.abs(Math.round(t.delta * 100))} %`}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/** Segundos como m:ss. */
export const clockLabel = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

const pct1 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Porcentaje con un decimal y coma: «39,5 %». */
export const percentLabel = (v: number) => `${pct1.format(v)} %`;
