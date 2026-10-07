import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BarChart3 } from "lucide-react";
import { youTubeWatchUrl } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getChannelContext, getSupabase } from "@/lib/auth";

export const metadata: Metadata = { title: "Analítica" };

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations();
  const supabase = await getSupabase();
  const { data: videos } = await supabase
    .from("youtube_videos")
    .select(
      "video_id, title, thumbnail_url, privacy_status, published_at, publish_at, view_count, fetched_at",
    )
    .eq("channel_id", channelId)
    .order("published_at", { ascending: false, nullsFirst: true })
    .limit(20);
  const fmt = new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeZone: ctx.channel.timezone,
  });

  return (
    <Page>
      <PageHeader title={t("analytics.title")} />
      <div className="space-y-6">
        <EmptyState
          icon={<BarChart3 className="size-8" />}
          title={t("analytics.emptyTitle")}
          description={t("analytics.emptyDesc")}
        />
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
