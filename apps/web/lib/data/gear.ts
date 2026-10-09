import "server-only";
import type { Tables } from "@planificador/db";
import { getSupabase } from "../auth";
import { MEDIA_BUCKET, SIGNED_URL_SECONDS } from "../media";

export type GearRow = Tables<"gear">;
export type GearView = GearRow & { photoUrl: string | null };

/** El inventario del canal, con las fotos firmadas para quien lo ve. */
export async function loadGear(channelId: string): Promise<GearView[]> {
  const supabase = await getSupabase();
  const { data } = await supabase
    .from("gear")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  const paths = rows.flatMap((r) => (r.photo_path ? [r.photo_path] : []));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    ...r,
    photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
  }));
}
