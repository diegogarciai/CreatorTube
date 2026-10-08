import "server-only";
import { createHash } from "node:crypto";
import { DEFAULT_CHECKLIST, localDateKey, type EpisodeStatus } from "@planificador/core";
import {
  decryptSecret,
  encryptSecret,
  parseKey,
  syncChannel,
  type GoogleOAuthConfig,
  type LinkedEpisode,
  type SyncResult,
  type SyncStore,
  type TokenSet,
} from "@planificador/youtube";
import { env } from "./env";
import { createAdminClient } from "./supabase/admin";

export function oauthConfig(): GoogleOAuthConfig {
  return {
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: `${env.appUrl}/api/youtube/callback`,
  };
}

export function encryptionKey(): Buffer {
  return parseKey(env.tokenEncryptionKey);
}

/** Clave derivada para firmar el state de OAuth (distinta de la de cifrado). */
export function stateKey(): Buffer {
  return createHash("sha256").update("oauth-state:").update(encryptionKey()).digest();
}

export const NONCE_COOKIE = "yt_oauth_nonce";

type Admin = ReturnType<typeof createAdminClient>;

export async function saveConnection(
  admin: Admin,
  channelId: string,
  tokens: TokenSet,
  previousRefresh: string | null = null,
) {
  const key = encryptionKey();
  const refresh = tokens.refreshToken ?? previousRefresh;
  const { error } = await admin.from("channel_connections").upsert({
    channel_id: channelId,
    access_token_enc: encryptSecret(tokens.accessToken, key),
    refresh_token_enc: refresh ? encryptSecret(refresh, key) : null,
    token_expires_at: tokens.expiresAt.toISOString(),
    scopes: tokens.scopes,
    status: "active",
    last_verified_at: new Date().toISOString(),
    last_error: null,
  });
  if (error) throw error;
}

export async function seedChannelDefaults(admin: Admin, channelId: string) {
  const { count } = await admin
    .from("checklist_steps")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId);
  if (count) return;
  const rows = DEFAULT_CHECKLIST.map((s, i) => ({
    channel_id: channelId,
    label: s.label,
    phase: s.phase,
    position: i,
  }));
  await admin.from("checklist_steps").insert(rows);
}

export function supabaseStore(admin: Admin, timezone: string): SyncStore {
  return {
    async saveTokens(channelId, tokens) {
      await saveConnection(admin, channelId, tokens);
    },
    async markNeedsReauth(channelId, error) {
      await admin
        .from("channel_connections")
        .update({ status: "needs_reauth", last_error: error })
        .eq("channel_id", channelId);
    },
    async upsertVideos(channelId, videos, fetchedAt) {
      if (videos.length === 0) return;
      const { error } = await admin.from("youtube_videos").upsert(
        videos.map((v) => ({
          channel_id: channelId,
          video_id: v.id,
          title: v.title,
          description: v.description,
          thumbnail_url: v.thumbnailUrl,
          privacy_status: v.privacyStatus,
          publish_at: v.publishAt?.toISOString() ?? null,
          published_at: v.publishedAt?.toISOString() ?? null,
          duration_seconds: v.durationSeconds,
          view_count: v.viewCount,
          like_count: v.likeCount,
          comment_count: v.commentCount,
          tags: v.tags,
          fetched_at: fetchedAt.toISOString(),
        })),
      );
      if (error) throw error;
    },
    async linkedEpisodes(channelId, videoIds): Promise<LinkedEpisode[]> {
      if (videoIds.length === 0) return [];
      const { data, error } = await admin
        .from("episodes")
        .select(
          "id, status, stage, publish_date, record_date, youtube_video_id, published_at, evaluated_at, archived_at",
        )
        .eq("channel_id", channelId)
        .in("youtube_video_id", videoIds);
      if (error) throw error;
      return (data ?? []).map((e) => ({
        id: e.id,
        status: e.status,
        stage: e.stage,
        publishDate: e.publish_date,
        recordDate: e.record_date,
        youtubeVideoId: e.youtube_video_id,
        publishedOn: e.published_at ? localDateKey(new Date(e.published_at), timezone) : null,
        evaluatedAt: e.evaluated_at ? new Date(e.evaluated_at) : null,
        archivedAt: e.archived_at ? new Date(e.archived_at) : null,
      }));
    },
    async updateEpisode(episodeId, change, video) {
      const { error } = await admin
        .from("episodes")
        .update({
          status: change.status as EpisodeStatus,
          stage: change.stage,
          scheduled_at: video.scheduledAt?.toISOString() ?? null,
          published_at: video.publishedAt?.toISOString() ?? null,
        })
        .eq("id", episodeId);
      if (error) throw error;
    },
    async recordSync(channelId, result) {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await admin
        .from("channel_connections")
        .select("quota_day, quota_used")
        .eq("channel_id", channelId)
        .single();
      const used = data?.quota_day === today ? data.quota_used : 0;
      await admin
        .from("channel_connections")
        .update({
          quota_day: today,
          quota_used: used + result.quotaUsed,
          last_error: result.error,
          ...(result.error ? {} : { last_synced_at: new Date().toISOString() }),
        })
        .eq("channel_id", channelId);
    },
  };
}

/** Sincroniza un canal con su conexión guardada. */
export async function syncChannelById(
  admin: Admin,
  channelId: string,
  { maxVideos }: { maxVideos?: number } = {},
): Promise<SyncResult | null> {
  const { data: conn } = await admin
    .from("channel_connections")
    .select(
      "channel_id, access_token_enc, refresh_token_enc, token_expires_at, status, channel:channels(timezone)",
    )
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!conn || conn.status === "revoked") return null;
  const key = encryptionKey();
  const timezone = conn.channel?.timezone ?? "UTC";
  return syncChannel(
    {
      channelId,
      timezone,
      accessToken: conn.access_token_enc ? decryptSecret(conn.access_token_enc, key) : null,
      refreshToken: conn.refresh_token_enc ? decryptSecret(conn.refresh_token_enc, key) : null,
      tokenExpiresAt: conn.token_expires_at ? new Date(conn.token_expires_at) : null,
    },
    { oauth: oauthConfig(), store: supabaseStore(admin, timezone), maxVideos },
  );
}

/** Token guardado, descifrado. `"refresh"` solo el de refresco; `"revocable"` el de refresco o, si falta, el de acceso. */
export async function decryptedToken(
  admin: Admin,
  channelId: string,
  kind: "refresh" | "revocable",
): Promise<string | null> {
  const { data } = await admin
    .from("channel_connections")
    .select("refresh_token_enc, access_token_enc")
    .eq("channel_id", channelId)
    .maybeSingle();
  const enc =
    kind === "refresh"
      ? data?.refresh_token_enc
      : (data?.refresh_token_enc ?? data?.access_token_enc);
  return enc ? decryptSecret(enc, encryptionKey()) : null;
}
