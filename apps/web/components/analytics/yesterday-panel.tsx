import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { youTubeWatchUrl } from "@planificador/core";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { YesterdayView } from "@/lib/data/analytics";
import { compare } from "@/lib/daily-report";
import { cn } from "@/lib/utils";
import { clockLabel, StatTiles } from "./stat-tiles";

const int = new Intl.NumberFormat("es-CO");
const pct = (v: number) => `${Math.round(Math.abs(v) * 100)} %`;

/**
 * «Así te fue ayer», lo primero de Analítica: las últimas ~24 horas con los
 * contadores públicos (YouTube Analytics llega con días de atraso), comparadas
 * con el día típico del canal, el video que más sumó y una frase; debajo, el
 * último día completo de Analytics.
 */
export async function YesterdayPanel({
  view,
  channelId,
  timezone,
}: {
  view: YesterdayView;
  channelId: string;
  timezone: string;
}) {
  const t = await getTranslations("analytics.yesterday");
  const { report: y, summary, typical, lastDay } = view;
  const time = new Intl.DateTimeFormat("es", {
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  });
  const dayFmt = new Intl.DateTimeFormat("es", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const top = y?.top ? view.videos[y.top.videoId] : null;
  const driver = summary?.driver ? view.videos[summary.driver.videoId] : null;

  let headline = "";
  if (y && summary) {
    headline =
      summary.tone === "good"
        ? t("good", { pct: pct(summary.change!) })
        : summary.tone === "weak"
          ? t("weak", { pct: pct(summary.change!) })
          : summary.tone === "normal"
            ? t("normal", {
                views: int.format(y.views),
                typical: int.format(Math.round(typical!.views)),
              })
            : t("plain", { views: int.format(y.views) });
    if (summary.driver && driver)
      headline += t("driver", { title: driver.title, views: int.format(summary.driver.views) });
  }

  return (
    <Card data-testid="yesterday-panel">
      <CardHeader
        title={t("title")}
        description={
          y ? (
            <span
              data-testid="yesterday-headline"
              className={cn(
                "font-medium",
                summary?.tone === "good" && "text-ok",
                summary?.tone === "weak" && "text-critical",
                (summary?.tone === "normal" || !summary?.tone) && "text-text",
              )}
            >
              {headline}
            </span>
          ) : undefined
        }
      />
      <CardBody className="space-y-5">
        {y ? (
          <section className="space-y-2">
            <StatTiles
              tiles={[
                {
                  label: t("views"),
                  value: int.format(y.views),
                  delta: compare(y.views, typical?.views),
                },
                {
                  label: t("likes"),
                  value: int.format(y.likes),
                  delta: compare(y.likes, typical?.likes),
                },
                {
                  label: t("comments"),
                  value: int.format(y.comments),
                  delta: compare(y.comments, typical?.comments),
                },
              ]}
            />
            <p className="text-xs text-muted">
              {t("window", {
                from: time.format(new Date(y.from)),
                to: time.format(new Date(y.to)),
              })}
              {typical ? ` ${t("vsTypical")}` : ""}
            </p>
            {y.top && top ? (
              <div
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                data-testid="yesterday-top"
              >
                {top.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={top.thumbnailUrl}
                    alt=""
                    className="h-10 w-16 shrink-0 rounded object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">{t("topVideo")}</p>
                  {top.episodeId ? (
                    <Link
                      href={`/c/${channelId}/episodios/${top.episodeId}?tab=metrics`}
                      className="line-clamp-1 font-medium hover:underline"
                    >
                      {top.title}
                    </Link>
                  ) : (
                    <a
                      href={youTubeWatchUrl(y.top.videoId)}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-1 font-medium hover:underline"
                    >
                      {top.title}
                    </a>
                  )}
                </div>
                <span className="shrink-0 font-medium tabular-nums">
                  {t("topViews", { views: int.format(y.top.views) })}
                </span>
              </div>
            ) : null}
          </section>
        ) : (
          <p
            className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted"
            data-testid="yesterday-pending"
          >
            {view.hasSnapshots ? t("pendingTomorrow") : t("pendingFirst")}
          </p>
        )}
        {lastDay ? (
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold first-letter:uppercase">
              {t("lastDay", { day: dayFmt.format(new Date(`${lastDay.day}T00:00:00Z`)) })}
            </h3>
            <StatTiles
              tiles={[
                {
                  label: t("views"),
                  value: int.format(lastDay.views),
                  delta: compare(lastDay.views, typical?.views),
                },
                {
                  label: t("watchHours"),
                  value: int.format(Math.round(lastDay.watchMinutes / 60)),
                  delta: compare(lastDay.watchMinutes, typical?.watchMinutes),
                },
                {
                  label: t("subscribers"),
                  value: `${lastDay.subscribersNet >= 0 ? "+" : ""}${int.format(lastDay.subscribersNet)}`,
                  delta: compare(lastDay.subscribersNet, typical?.subscribersNet),
                },
                {
                  label: t("avgDuration"),
                  value: clockLabel(lastDay.averageViewDurationS),
                  delta: compare(lastDay.averageViewDurationS, typical?.averageViewDurationS),
                },
              ]}
            />
            <p className="text-xs text-muted">{t("lastDayNote")}</p>
          </section>
        ) : null}
      </CardBody>
    </Card>
  );
}
