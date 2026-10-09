import "server-only";
import { freshAccessToken, YouTubeClient } from "@planificador/youtube";
import { createAdminClient } from "./supabase/admin";
import { oauthConfig, supabaseStore } from "./youtube";
import { storedConnection } from "./youtube-analytics";

type Admin = ReturnType<typeof createAdminClient>;

/** Margen bajo la cuota diaria de 10.000 unidades (igual que el cron). */
export const DAILY_QUOTA_BUDGET = 9_000;

/** Un cliente de la Data API con el token vigente del canal (null sin conexión activa). */
export async function channelClient(
  admin: Admin,
  channelId: string,
): Promise<{ client: YouTubeClient; scopes: string[]; quotaToday: number } | null> {
  const stored = await storedConnection(admin, channelId);
  if (!stored) return null;
  const token = await freshAccessToken(
    stored.conn,
    oauthConfig(),
    supabaseStore(admin, stored.timezone),
    fetch,
    new Date(),
  );
  const { data } = await admin
    .from("channel_connections")
    .select("scopes, quota_day, quota_used")
    .eq("channel_id", channelId)
    .single();
  const today = new Date().toISOString().slice(0, 10);
  return {
    client: new YouTubeClient(token),
    scopes: data?.scopes ?? [],
    quotaToday: data?.quota_day === today ? data.quota_used : 0,
  };
}

/** Suma unidades a la cuota de hoy del canal. */
export async function addQuota(admin: Admin, channelId: string, units: number) {
  if (!units) return;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("channel_connections")
    .select("quota_day, quota_used")
    .eq("channel_id", channelId)
    .single();
  const used = data?.quota_day === today ? data.quota_used : 0;
  await admin
    .from("channel_connections")
    .update({ quota_day: today, quota_used: used + units })
    .eq("channel_id", channelId);
}
