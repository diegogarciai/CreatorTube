import { getTranslations } from "next-intl/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { EpisodeMetrics } from "@/lib/data/analytics";
import { DailyChart } from "./daily-chart";
import { ReachCard } from "./reach-card";
import { RetentionChart, TopDrops } from "./retention-chart";
import { clockLabel, percentLabel, StatTiles } from "./stat-tiles";

const int = new Intl.NumberFormat("es-CO");

/** Pestaña Métricas del episodio: cifras, vistas por día y retención con el guion. */
export async function EpisodeMetricsPanel({
  metrics,
  durationS,
  timezone,
}: {
  metrics: EpisodeMetrics;
  durationS: number | null;
  timezone: string;
}) {
  const t = await getTranslations();
  const fmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeZone: timezone });
  const m = metrics.totals;
  const source = {
    fix: t("metrics.sourceFix"),
    revision: t("metrics.sourceRevision"),
    teleprompter: t("metrics.sourceTeleprompter"),
  };
  return (
    <div className="space-y-6" data-testid="episode-metrics">
      {m ? (
        <section className="space-y-2">
          <StatTiles
            tiles={[
              { label: t("analytics.tile.views"), value: int.format(m.views) },
              {
                label: t("analytics.tile.watchHours"),
                value: int.format(Math.round(m.watchMinutes / 60)),
              },
              { label: t("analytics.tile.avgDuration"), value: clockLabel(m.averageViewDurationS) },
              {
                label: t("analytics.tile.avgPercentage"),
                value: percentLabel(m.averageViewPercentage),
              },
              {
                label: t("analytics.tile.subscribers"),
                value: `${m.subscribersNet >= 0 ? "+" : ""}${int.format(m.subscribersNet)}`,
              },
            ]}
          />
          <p className="text-xs text-muted">
            {t("metrics.source", {
              date: metrics.fetchedAt ? fmt.format(new Date(metrics.fetchedAt)) : "—",
            })}
          </p>
        </section>
      ) : (
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted">
          {t("metrics.noData")}
        </p>
      )}
      {metrics.daily.length > 1 ? (
        <Card>
          <CardHeader title={t("metrics.dailyViews")} />
          <CardBody>
            <DailyChart points={metrics.daily} label={t("analytics.tile.views")} />
          </CardBody>
        </Card>
      ) : null}
      <ReachCard
        title={t("metrics.reachTitle")}
        description={t("metrics.reachDesc")}
        totals={metrics.reach?.total ?? null}
        sources={metrics.reach?.sources ?? []}
        testId="episode-reach"
      />
      <Card>
        <CardHeader title={t("metrics.retentionTitle")} description={t("metrics.retentionDesc")} />
        <CardBody className="space-y-4">
          {metrics.retention.length ? (
            <>
              <RetentionChart
                points={metrics.retention}
                paragraphs={metrics.paragraphs}
                durationS={durationS}
              />
              {metrics.paragraphs.length ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">{t("metrics.dropsTitle")}</h3>
                  <TopDrops paragraphs={metrics.paragraphs} durationS={durationS} />
                  <p className="text-xs text-muted">
                    {t("metrics.estimate", { source: source[metrics.scriptSource ?? "fix"] })}
                  </p>
                </section>
              ) : (
                <p className="text-xs text-muted">{t("metrics.noScript")}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted" data-testid="no-retention">
              {t("metrics.noRetention")}
            </p>
          )}
        </CardBody>
      </Card>
      <p className="text-xs text-muted">{t("episode.tabPlaceholder.metrics")}</p>
    </div>
  );
}
