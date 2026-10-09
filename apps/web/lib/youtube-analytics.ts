import "server-only";
import {
  decryptSecret,
  syncAnalytics,
  syncReach,
  type AnalyticsResult,
  type AnalyticsStore,
  type DailyMetrics,
  type ReachResult,
  type ReachStore,
  type ReportingState,
  type StoredConnection,
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
    async saveSearchTerms(channelId, terms, periodEnd, fetchedAt) {
      const { error: delError } = await admin
        .from("youtube_search_terms")
        .delete()
        .eq("channel_id", channelId);
      if (delError) throw delError;
      if (!terms.length) return;
      // La misma búsqueda puede venir con mayúsculas distintas: se suman.
      const byTerm = new Map<string, { views: number; watchMinutes: number }>();
      for (const t of terms) {
        const key = t.term.toLowerCase().slice(0, 300);
        const cur = byTerm.get(key) ?? { views: 0, watchMinutes: 0 };
        byTerm.set(key, {
          views: cur.views + t.views,
          watchMinutes: cur.watchMinutes + t.watchMinutes,
        });
      }
      const { error } = await admin.from("youtube_search_terms").insert(
        [...byTerm].map(([term, v]) => ({
          channel_id: channelId,
          term,
          views: v.views,
          watch_minutes: v.watchMinutes,
          period_end: periodEnd,
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

/** La conexión guardada del canal, con los tokens descifrados (null si no está activa). */
export async function storedConnection(
  admin: Admin,
  channelId: string,
): Promise<{ conn: StoredConnection; timezone: string } | null> {
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
  return {
    timezone,
    conn: {
      channelId,
      timezone,
      accessToken: conn.access_token_enc ? decryptSecret(conn.access_token_enc, key) : null,
      refreshToken: conn.refresh_token_enc ? decryptSecret(conn.refresh_token_enc, key) : null,
      tokenExpiresAt: conn.token_expires_at ? new Date(conn.token_expires_at) : null,
    },
  };
}

/** Trae la analítica de un canal con su conexión guardada (null si no hay conexión activa). */
export async function syncAnalyticsById(
  admin: Admin,
  channelId: string,
): Promise<AnalyticsResult | null> {
  const stored = await storedConnection(admin, channelId);
  if (!stored) return null;
  return syncAnalytics(stored.conn, {
    oauth: oauthConfig(),
    store: analyticsStore(admin, stored.timezone),
  });
}

function reachStore(admin: Admin, timezone: string): ReachStore {
  const base = supabaseStore(admin, timezone);
  // Un reporte regenerado reemplaza los días que trae (en las fuentes, también las que ya no están).
  const clearDays = async (
    table: "youtube_video_reach_daily" | "youtube_video_reach_sources",
    channelId: string,
    days: string[],
  ) => {
    if (!days.length) return;
    const { error } = await admin
      .from(table)
      .delete()
      .eq("channel_id", channelId)
      .in("day", [...new Set(days)]);
    if (error) throw error;
  };
  return {
    saveTokens: base.saveTokens,
    markNeedsReauth: base.markNeedsReauth,
    async reportingState(channelId) {
      const { data } = await admin
        .from("channel_connections")
        .select("reporting")
        .eq("channel_id", channelId)
        .maybeSingle();
      return (data?.reporting ?? {}) as ReportingState;
    },
    async saveReportingState(channelId, state) {
      const { error } = await admin
        .from("channel_connections")
        .update({ reporting: state as unknown as Json })
        .eq("channel_id", channelId);
      if (error) throw error;
    },
    async saveReach(channelId, rows, fetchedAt) {
      await clearDays(
        "youtube_video_reach_daily",
        channelId,
        rows.map((r) => r.day),
      );
      if (!rows.length) return;
      const { error } = await admin.from("youtube_video_reach_daily").upsert(
        rows.map((r) => ({
          channel_id: channelId,
          video_id: r.videoId,
          day: r.day,
          impressions: r.impressions,
          ctr: r.ctr,
          fetched_at: fetchedAt.toISOString(),
        })),
      );
      if (error) throw error;
    },
    async saveReachSources(channelId, rows, fetchedAt) {
      await clearDays(
        "youtube_video_reach_sources",
        channelId,
        rows.map((r) => r.day),
      );
      if (!rows.length) return;
      const { error } = await admin.from("youtube_video_reach_sources").upsert(
        rows.map((r) => ({
          channel_id: channelId,
          video_id: r.videoId,
          day: r.day,
          traffic_source: r.trafficSource,
          impressions: r.impressions,
          clicks: r.clicks,
          fetched_at: fetchedAt.toISOString(),
        })),
      );
      if (error) throw error;
    },
  };
}

/** Trae el alcance (impresiones, CTR y fuentes) con la Reporting API (null si no hay conexión). */
export async function syncReachById(admin: Admin, channelId: string): Promise<ReachResult | null> {
  const stored = await storedConnection(admin, channelId);
  if (!stored) return null;
  return syncReach(stored.conn, {
    oauth: oauthConfig(),
    store: reachStore(admin, stored.timezone),
  });
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
