import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BarChart3 } from "lucide-react";
import { youTubeWatchUrl } from "@planificador/core";
import { AuditCard } from "@/components/analytics/audit-card";
import { DailyChart } from "@/components/analytics/daily-chart";
import { ctrLabel, ReachCard } from "@/components/analytics/reach-card";
import { RefreshAnalyticsButton } from "@/components/analytics/refresh-button";
import { SearchTermsCard } from "@/components/analytics/search-terms-card";
import { YesterdayPanel } from "@/components/analytics/yesterday-panel";
import { clockLabel, percentLabel, StatTiles } from "@/components/analytics/stat-tiles";
import { Page, PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getChannelContext, getSupabase } from "@/lib/auth";
import {
  loadChannelAnalytics,
  loadSearchTerms,
  loadYesterday,
  type PeriodTotals,
} from "@/lib/data/analytics";
import { loadAudits } from "@/lib/data/evaluation";

export const metadata: Metadata = { title: "Analítica" };

const int = new Intl.NumberFormat("es-CO");
const change = (now: number, before: number | undefined) =>
  before ? (now - before) / Math.abs(before) : null;

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations();
  const supabase = await getSupabase();
  const [analytics, yesterday, { data: videos }, audits, search] = await Promise.all([
    loadChannelAnalytics(channelId),
    loadYesterday(channelId),
    supabase
      .from("youtube_videos")
      .select(
        "video_id, title, thumbnail_url, privacy_status, published_at, publish_at, view_count, fetched_at",
      )
      .eq("channel_id", channelId)
      .order("published_at", { ascending: false, nullsFirst: true })
      .limit(20),
    loadAudits(channelId),
    loadSearchTerms(channelId),
  ]);
  const fmt = new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeZone: ctx.channel.timezone,
  });
  const { current: c, previous: p } = analytics;
  const tiles = (cur: PeriodTotals, prev: PeriodTotals | null) => [
    {
      label: t("analytics.tile.views"),
      value: int.format(cur.views),
      delta: change(cur.views, prev?.views),
    },
    {
      label: t("analytics.tile.watchHours"),
      value: int.format(Math.round(cur.watchMinutes / 60)),
      delta: change(cur.watchMinutes, prev?.watchMinutes),
    },
    {
      label: t("analytics.tile.subscribers"),
      value: `${cur.subscribersNet >= 0 ? "+" : ""}${int.format(cur.subscribersNet)}`,
      delta: change(cur.subscribersNet, prev?.subscribersNet),
    },
    {
      label: t("analytics.tile.avgDuration"),
      value: clockLabel(cur.averageViewDurationS),
      delta: change(cur.averageViewDurationS, prev?.averageViewDurationS),
    },
    {
      label: t("analytics.tile.avgPercentage"),
      value: percentLabel(cur.averageViewPercentage),
      delta: change(cur.averageViewPercentage, prev?.averageViewPercentage),
    },
  ];

  return (
    <Page>
      <PageHeader
        title={t("analytics.title")}
        actions={<RefreshAnalyticsButton channelId={channelId} />}
      />
      <div className="space-y-6">
        {analytics.connected || yesterday.hasSnapshots ? (
          <YesterdayPanel view={yesterday} channelId={channelId} timezone={ctx.channel.timezone} />
        ) : null}
        {analytics.connected ? (
          <>
            <section className="space-y-2">
              <StatTiles tiles={tiles(c, p)} />
              <p className="text-xs text-muted">
                {t("analytics.source", {
                  date: analytics.fetchedAt ? fmt.format(new Date(analytics.fetchedAt)) : "—",
                })}
                {p ? ` ${t("analytics.vsPrevious")}` : ""}
              </p>
            </section>
            <Card>
              <CardHeader title={t("analytics.dailyViews")} description={t("analytics.last28")} />
              <CardBody>
                <DailyChart points={analytics.daily} label={t("analytics.tile.views")} />
              </CardBody>
            </Card>
            <ReachCard
              title={t("analytics.reachTitle")}
              description={t("analytics.reachDesc", {
                date: analytics.reach
                  ? fmt.format(new Date(`${analytics.reach.lastDay}T12:00:00Z`))
                  : "—",
              })}
              totals={analytics.reach?.current ?? null}
              previous={analytics.reach?.previous}
              sources={analytics.reach?.sources ?? []}
            />
            {search.terms.length ? (
              <SearchTermsCard
                channelId={channelId}
                terms={search.terms}
                periodEnd={search.periodEnd}
                canIdea={ctx.can("write_script")}
              />
            ) : null}
            <Card>
              <CardHeader
                title={t("analytics.episodesTitle")}
                description={t("analytics.episodesDesc")}
              />
              {analytics.episodes.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm" data-testid="episode-analytics">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted">
                        <th className="px-5 py-2 font-medium">{t("analytics.col.episode")}</th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("analytics.col.week")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("analytics.col.total")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("analytics.col.pct")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("analytics.col.duration")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("analytics.col.impressions")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("analytics.col.ctr")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("analytics.col.likes")}
                        </th>
                        <th className="px-5 py-2 text-right font-medium">
                          {t("analytics.col.comments")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.episodes.map((e) => (
                        <tr key={e.episodeId} className="border-b border-border last:border-0">
                          <td className="px-5 py-2">
                            <Link
                              href={`/c/${channelId}/episodios/${e.episodeId}?tab=metrics`}
                              className="font-medium hover:underline"
                            >
                              {e.title}
                            </Link>
                            <div className="text-xs text-muted">
                              {e.code} · {fmt.format(new Date(e.publishedAt))}
                              {e.hasRetention ? ` · ${t("analytics.hasRetention")}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {int.format(e.firstWeek.views)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {int.format(e.total.views)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {percentLabel(e.total.averageViewPercentage)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {clockLabel(e.total.averageViewDurationS)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {e.reach ? int.format(e.reach.total.impressions) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {e.reach ? ctrLabel(e.reach.total.ctr) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {int.format(e.total.likes)}
                          </td>
                          <td className="px-5 py-2 text-right tabular-nums">
                            {int.format(e.total.comments)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-5 py-4 text-sm text-muted">{t("analytics.noEpisodes")}</p>
              )}
            </Card>
          </>
        ) : (
          <EmptyState
            icon={<BarChart3 className="size-8" />}
            title={t("analytics.emptyTitle")}
            description={t("analytics.emptyDesc")}
          />
        )}
        {analytics.connected || audits.months.length ? (
          <AuditCard
            channelId={channelId}
            view={audits}
            canAudit={ctx.can("manage_episodes")}
            canIdea={ctx.can("write_script")}
          />
        ) : null}
        <Card>
          <CardHeader title={t("analytics.recentVideos")} description="YouTube Data API" />
          {videos && videos.length > 0 ? (
            <ul className="divide-y divide-border">
              {videos.map((v) => (
                <li key={v.video_id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  {v.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.thumbnail_url}
                      alt=""
                      className="h-12 w-20 shrink-0 rounded object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <a
                      href={youTubeWatchUrl(v.video_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-1 font-medium hover:underline"
                    >
                      {v.title ?? v.video_id}
                    </a>
                    <p className="text-xs text-muted">
                      {t(`episode.youtubePrivacy.${(v.privacy_status ?? "private") as "private"}`)}
                      {v.published_at
                        ? ` · ${fmt.format(new Date(v.published_at))}`
                        : v.publish_at
                          ? ` · ▶ ${fmt.format(new Date(v.publish_at))}`
                          : ""}
                      {" · "}
                      {t("analytics.fetchedAt", { date: fmt.format(new Date(v.fetched_at)) })}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums text-muted">
                    {t("analytics.views", { count: v.view_count ?? 0 })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted">{t("analytics.noVideos")}</p>
          )}
        </Card>
      </div>
    </Page>
  );
}
