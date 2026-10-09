import { getTranslations } from "next-intl/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { ReachTotals, SourceRow } from "@/lib/reach";
import { percentLabel, StatTiles } from "./stat-tiles";

const int = new Intl.NumberFormat("es-CO");
const change = (now: number | null, before: number | null | undefined) =>
  now !== null && before ? (now - before) / Math.abs(before) : null;
/** CTR (0 a 1) como porcentaje con un decimal. */
export const ctrLabel = (ctr: number | null) => (ctr === null ? "—" : percentLabel(ctr * 100));

/**
 * Alcance de las miniaturas: impresiones, CTR y de dónde salieron (Reporting
 * API). Sin reportes todavía, avisa que llegan con hasta 48 h de atraso.
 */
export async function ReachCard({
  title,
  description,
  totals,
  previous,
  sources,
  testId = "reach",
}: {
  title: string;
  description: string;
  totals: ReachTotals | null;
  previous?: ReachTotals | null;
  sources: SourceRow[];
  testId?: string;
}) {
  const t = await getTranslations("analytics");
  return (
    <Card data-testid={testId}>
      <CardHeader title={title} description={description} />
      <CardBody className="space-y-4">
        {totals ? (
          <>
            <StatTiles
              tiles={[
                {
                  label: t("tile.impressions"),
                  value: int.format(totals.impressions),
                  delta: change(totals.impressions, previous?.impressions),
                },
                {
                  label: t("tile.ctr"),
                  value: ctrLabel(totals.ctr),
                  delta: change(totals.ctr, previous?.ctr),
                },
              ]}
            />
            {sources.length ? (
              <section className="space-y-2" data-testid={`${testId}-sources`}>
                <h3 className="text-sm font-medium">{t("sourcesTitle")}</h3>
                <ul className="space-y-1.5">
                  {sources.map((s, i) => (
                    <li
                      key={s.code}
                      className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm"
                    >
                      <span className="truncate">{s.label}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
                        <span
                          className={
                            i === 0 ? "block h-full bg-accent" : "block h-full bg-muted/40"
                          }
                          style={{ width: `${Math.max(s.share * 100, 1)}%` }}
                        />
                      </span>
                      <span className="text-right text-xs text-muted tabular-nums">
                        {t("sourceLine", {
                          impressions: int.format(s.impressions),
                          share: percentLabel(s.share * 100),
                          ctr: ctrLabel(s.ctr),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <p className="text-xs text-muted">{t("reachNote")}</p>
          </>
        ) : (
          <p
            className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted"
            data-testid={`${testId}-pending`}
          >
            {t("reachPending")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
