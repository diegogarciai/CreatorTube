import "server-only";
import { gearLabel, type EpisodeGear, type GearOwnership, type GearRole } from "@planificador/core";
import type { Tables } from "@planificador/db";
import { getSupabase } from "../auth";
import { MEDIA_BUCKET, SIGNED_URL_SECONDS } from "../media";

export type GearRow = Tables<"gear">;
export type GearView = GearRow & {
  photoUrl: string | null;
  /** En cuántos episodios sale (protagonista o herramienta). */
  episodes: number;
};

async function signPhotos(paths: string[]) {
  const urls = new Map<string, string>();
  if (!paths.length) return urls;
  const supabase = await getSupabase();
  const { data: signed } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);
  for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  return urls;
}

/** El inventario del canal, con las fotos firmadas y en cuántos episodios sale cada equipo. */
export async function loadGear(channelId: string): Promise<GearView[]> {
  const supabase = await getSupabase();
  const [{ data }, { data: links }] = await Promise.all([
    supabase
      .from("gear")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false }),
    supabase.from("episode_gear").select("gear_id").eq("channel_id", channelId),
  ]);
  const rows = data ?? [];
  const urls = await signPhotos(rows.flatMap((r) => (r.photo_path ? [r.photo_path] : [])));
  const counts = new Map<string, number>();
  for (const l of links ?? []) counts.set(l.gear_id, (counts.get(l.gear_id) ?? 0) + 1);
  return rows.map((r) => ({
    ...r,
    photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
    episodes: counts.get(r.id) ?? 0,
  }));
}

export type LinkedGear = EpisodeGear & { gearId: string; hasPhoto: boolean };

/** El equipo del episodio y el que se le puede sumar (activo y sin unir). */
export async function loadEpisodeGear(channelId: string, episodeId: string) {
  const supabase = await getSupabase();
  const [{ data: links }, { data: gear }] = await Promise.all([
    supabase.from("episode_gear").select("gear_id, role").eq("episode_id", episodeId),
    supabase
      .from("gear")
      .select("id, name, brand, model, ownership, affiliate_url, photo_path, status")
      .eq("channel_id", channelId)
      .order("name"),
  ]);
  const byId = new Map((gear ?? []).map((g) => [g.id, g]));
  const linked: LinkedGear[] = (links ?? []).flatMap((l) => {
    const g = byId.get(l.gear_id);
    return g
      ? [
          {
            gearId: g.id,
            label: gearLabel(g),
            brand: g.brand,
            role: l.role as GearRole,
            ownership: g.ownership as GearOwnership,
            affiliateUrl: g.affiliate_url,
            hasPhoto: Boolean(g.photo_path),
          },
        ]
      : [];
  });
  // Protagonistas primero.
  linked.sort((a, b) =>
    a.role === b.role ? a.label.localeCompare(b.label) : a.role === "protagonist" ? -1 : 1,
  );
  const taken = new Set(linked.map((l) => l.gearId));
  const options = (gear ?? [])
    .filter((g) => g.status === "active" && !taken.has(g.id))
    .map((g) => ({ id: g.id, label: gearLabel(g) }));
  return { linked, options };
}
