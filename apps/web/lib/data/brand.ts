import "server-only";
import { parseBrandKit, type BrandKit } from "@planificador/core";
import { getSupabase } from "../auth";
import { MEDIA_BUCKET, SIGNED_URL_SECONDS } from "../media";

export type PresenterPhotoView = { id: string; label: string | null; url: string | null };

export type BrandView = {
  kit: BrandKit;
  /** Aún no se ha guardado: se ven los valores por defecto. */
  isDefault: boolean;
  logoUrl: string | null;
  photos: PresenterPhotoView[];
};

/** El kit del canal y sus archivos, con URLs firmadas para quien lo ve. */
export async function loadBrandView(channelId: string): Promise<BrandView> {
  const supabase = await getSupabase();
  const [{ data: row }, { data: photos }] = await Promise.all([
    supabase
      .from("brand_kits")
      .select("colors, fonts, style, thumbnail_style, logo_path")
      .eq("channel_id", channelId)
      .maybeSingle(),
    supabase
      .from("presenter_photos")
      .select("id, path, label")
      .eq("channel_id", channelId)
      .order("created_at"),
  ]);
  const kit = parseBrandKit(row);
  const paths = [...(kit.logoPath ? [kit.logoPath] : []), ...(photos ?? []).map((p) => p.path)];
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return {
    kit,
    isDefault: !row,
    logoUrl: kit.logoPath ? (urls.get(kit.logoPath) ?? null) : null,
    photos: (photos ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      url: urls.get(p.path) ?? null,
    })),
  };
}
