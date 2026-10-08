"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { brandKitSchema, isMediaPathOf, PRESENTER_PHOTOS_MAX } from "@planificador/core";
import { getSupabase, requireChannelPermission } from "../auth";
import { MEDIA_BUCKET } from "../media";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Kit de marca y fotos del presentador. Los archivos los sube el navegador
 * directo al bucket (las políticas de Storage revisan el permiso); aquí solo
 * se registran sus rutas.
 */

async function run(channelId: string, fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await requireChannelPermission(channelId, "configure_channel");
    await fn();
    revalidatePath(`/c/${channelId}/ajustes`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveBrandKit(channelId: string, input: unknown): Promise<ActionResult> {
  return run(channelId, async () => {
    const kit = brandKitSchema.parse(input);
    const supabase = await getSupabase();
    const { error } = await supabase.from("brand_kits").upsert(
      {
        channel_id: channelId,
        colors: kit.colors,
        fonts: kit.fonts,
        style: kit.style,
        thumbnail_style: kit.thumbnailStyle,
      },
      { onConflict: "channel_id" },
    );
    if (error) throw error;
  });
}

/** Pone (o quita, con null) el logo del canal y borra el archivo anterior. */
export async function setBrandLogo(channelId: string, path: string | null): Promise<ActionResult> {
  return run(channelId, async () => {
    if (path !== null && !isMediaPathOf(path, channelId, "brand"))
      throw new Error("errors.invalid_input");
    const supabase = await getSupabase();
    const { data: current } = await supabase
      .from("brand_kits")
      .select("logo_path")
      .eq("channel_id", channelId)
      .maybeSingle();
    const { error } = await supabase
      .from("brand_kits")
      .upsert({ channel_id: channelId, logo_path: path }, { onConflict: "channel_id" });
    if (error) throw error;
    if (current?.logo_path && current.logo_path !== path)
      await supabase.storage.from(MEDIA_BUCKET).remove([current.logo_path]);
  });
}

const photoSchema = z.object({
  path: z.string().max(200),
  label: z.string().trim().max(80).optional(),
});

export async function addPresenterPhoto(channelId: string, input: unknown): Promise<ActionResult> {
  return run(channelId, async () => {
    const { path, label } = photoSchema.parse(input);
    if (!isMediaPathOf(path, channelId, "presenter")) throw new Error("errors.invalid_input");
    const supabase = await getSupabase();
    const { count } = await supabase
      .from("presenter_photos")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId);
    if ((count ?? 0) >= PRESENTER_PHOTOS_MAX) throw new Error("errors.too_many_photos");
    const { error } = await supabase
      .from("presenter_photos")
      .insert({ channel_id: channelId, path, label: label || null });
    if (error) throw error;
  });
}

export async function deletePresenterPhoto(channelId: string, id: string): Promise<ActionResult> {
  return run(channelId, async () => {
    const supabase = await getSupabase();
    const { data: photo, error } = await supabase
      .from("presenter_photos")
      .delete()
      .eq("id", id)
      .eq("channel_id", channelId)
      .select("path")
      .maybeSingle();
    if (error) throw error;
    if (!photo) throw new Error("errors.not_found");
    await supabase.storage.from(MEDIA_BUCKET).remove([photo.path]);
  });
}
