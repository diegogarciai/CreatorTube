import "server-only";
import { outlierRatios } from "@planificador/core";
import { recentPublicVideos, type YouTubeClient } from "@planificador/youtube";
import { createAdminClient } from "./supabase/admin";
import { addQuota, channelClient, DAILY_QUOTA_BUDGET } from "./youtube-comments";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Competencia (banco de ideas): refresca las subidas recientes de un canal
 * seguido y calcula la razón de cada video contra la mediana de su canal.
 */
export async function syncCompetitor(
  admin: Admin,
  client: YouTubeClient,
  competitor: { id: string; channel_id: string; uploads_playlist_id: string },
  now = new Date(),
) {
  const videos = await recentPublicVideos(client, competitor.uploads_playlist_id);
  const { median, ratios } = outlierRatios(
    videos.map((v) => ({ id: v.id, views: v.viewCount ?? 0, publishedAt: v.publishedAt! })),
    now,
  );
  const fetchedAt = now.toISOString();
  // Lo que ya no está entre las recientes se va.
  const { error: delError } = await admin
    .from("competitor_videos")
    .delete()
    .eq("competitor_id", competitor.id)
    .not("video_id", "in", `(${videos.map((v) => v.id).join(",") || "x"})`);
  if (delError) throw delError;
  if (videos.length) {
    const { error } = await admin.from("competitor_videos").upsert(
      videos.map((v) => ({
        competitor_id: competitor.id,
        video_id: v.id,
        channel_id: competitor.channel_id,
        title: v.title.slice(0, 300),
        thumbnail_url: v.thumbnailUrl,
        published_at: v.publishedAt!.toISOString(),
        views: v.viewCount ?? 0,
        ratio: ratios.get(v.id) ?? null,
        fetched_at: fetchedAt,
      })),
    );
    if (error) throw error;
  }
  const { error } = await admin
    .from("competitor_channels")
    .update({ median_views: median, synced_at: fetchedAt })
    .eq("id", competitor.id);
  if (error) throw error;
  return videos.length;
}

/** Refresca todos los canales seguidos de un canal (cron diario). */
export async function syncCompetitorsById(admin: Admin, channelId: string) {
  const { data: competitors } = await admin
    .from("competitor_channels")
    .select("id, channel_id, uploads_playlist_id, youtube_channel_id")
    .eq("channel_id", channelId);
  if (!competitors?.length) return null;
  const yt = await channelClient(admin, channelId);
  if (!yt) return null;
  const out = { channel: channelId, competitors: 0, videos: 0, error: null as string | null };
  try {
    for (const c of competitors) {
      if (yt.quotaToday + yt.client.quotaUsed >= DAILY_QUOTA_BUDGET) break;
      // Refresca también los datos del canal (título y handle: regla de 30 días).
      const info = await yt.client.getChannel({ id: c.youtube_channel_id });
      if (info) {
        await admin
          .from("competitor_channels")
          .update({
            title: info.title,
            handle: info.handle,
            thumbnail_url: info.thumbnailUrl,
            uploads_playlist_id: info.uploadsPlaylistId ?? c.uploads_playlist_id,
          })
          .eq("id", c.id);
      }
      out.videos += await syncCompetitor(admin, yt.client, {
        ...c,
        uploads_playlist_id: info?.uploadsPlaylistId ?? c.uploads_playlist_id,
      });
      out.competitors++;
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  await addQuota(admin, channelId, yt.client.quotaUsed);
  return out;
}
