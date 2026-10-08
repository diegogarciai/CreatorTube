import "server-only";
import {
  decryptSecret,
  syncAnalytics,
  type AnalyticsResult,
  type AnalyticsStore,
  type DailyMetrics,
} from "@planificador/youtube";
import type { Json } from "@planificador/db";
import { createAdminClient } from "./supabase/admin";
import { encryptionKey, oauthConfig, supabaseStore } from "./youtube";

type Admin = ReturnType<typeof createAdminClient>;

/** «Actualizar ahora» no vuelve a pedir la analítica antes de esto. */
export const ANALYTICS_COOLDOWN_MS = 15 * 60_000;

const dayRow = (d: DailyMetrics) => ({
  day: d.day,
  views: d.views,
  watch_minutes: d.watchMinutes,
  average_view_duration_seconds: d.averageViewDurationS,
  average_view_percentage: d.averageViewPercentage,
  subscribers_gained: d.subscribersGained,
  subscribers_lost: d.subscribersLost,
  likes: d.likes,
  comments: d.comments,
  shares: d.shares,
});

function analyticsStore(admin: Admin, timezone: string): AnalyticsStore {
  const base = supabaseStore(admin, timezone);
  return {
    saveTokens: base.saveTokens,
    markNeedsReauth: base.markNeedsReauth,
    async lastChannelDay(channelId) {
      const { data } = await admin
        .from("youtube_channel_daily_stats")
        .select("day")
        .eq("channel_id", channelId)
        .order("day", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.day ?? null;
    },
    async saveChannelDays(channelId, days, fetchedAt) {
      if (!days.length) return;
      const { error } = await admin.from("youtube_channel_daily_stats").upsert(
        days.map((d) => ({
          channel_id: channelId,
          ...dayRow(d),
          fetched_at: fetchedAt.toISOString(),
        })),
      );
      if (error) throw error;
    },
    async publishedVideos(channelId, since) {
      const { data } = await admin
        .from("youtube_videos")
        .select("video_id, published_at")
        .eq("channel_id", channelId)
        .eq("privacy_status", "public")
        .gte("published_at", since.toISOString())
        .order("published_at", { ascending: false });
      return (data ?? []).map((v) => ({ id: v.video_id, publishedAt: new Date(v.published_at!) }));
    },
    async saveVideoDays(channelId, videoId, days, fetchedAt) {
      if (!days.length) return;
      const { error } = await admin.from("youtube_video_daily_stats").upsert(
        days.map((d) => ({
          channel_id: channelId,
          video_id: videoId,
          ...dayRow(d),
          fetched_at: fetchedAt.toISOString(),
        })),
      );
      if (error) throw error;
    },
    async saveRetention(channelId, videoId, points, fetchedAt) {
      const { error } = await admin.from("youtube_video_retention").upsert({
        channel_id: channelId,
        video_id: videoId,
        points: points as unknown as Json,
        fetched_at: fetchedAt.toISOString(),
      });
      if (error) throw error;
    },
  };
}

/** Trae la analítica de un canal con su conexión guardada (null si no hay conexión activa). */
export async function syncAnalyticsById(
  admin: Admin,
  channelId: string,
): Promise<AnalyticsResult | null> {
  const { data: conn } = await admin
    .from("channel_connections")
    .select(
      "channel_id, access_token_enc, refresh_token_enc, token_expires_at, status, channel:channels(timezone)",
    )
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!conn || conn.status !== "active") return null;
  const key = encryptionKey();
  const timezone = conn.channel?.timezone ?? "UTC";
  return syncAnalytics(
    {
      channelId,
      timezone,
      accessToken: conn.access_token_enc ? decryptSecret(conn.access_token_enc, key) : null,
      refreshToken: conn.refresh_token_enc ? decryptSecret(conn.refresh_token_enc, key) : null,
      tokenExpiresAt: conn.token_expires_at ? new Date(conn.token_expires_at) : null,
    },
    { oauth: oauthConfig(), store: analyticsStore(admin, timezone) },
  );
}

/** Cuándo se trajo por última vez la analítica del canal. */
export async function analyticsFetchedAt(admin: Admin, channelId: string): Promise<Date | null> {
  const { data } = await admin
    .from("youtube_channel_daily_stats")
    .select("fetched_at")
    .eq("channel_id", channelId)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? new Date(data.fetched_at) : null;
}
