"use client";

import {
  episodeRefPath,
  MEDIA_MAX_BYTES,
  MEDIA_MIME_TYPES,
  mediaPath,
  type MediaFolder,
} from "@planificador/core";
import { MEDIA_BUCKET } from "./media";
import { createClient } from "./supabase/browser";

/**
 * Sube un archivo al bucket del canal desde el navegador y devuelve su ruta.
 * Las políticas de Storage revisan que quien sube pueda configurar el canal.
 */
export async function uploadMedia(channelId: string, folder: MediaFolder, file: File) {
  if (!(MEDIA_MIME_TYPES as readonly string[]).includes(file.type))
    throw new Error("errors.invalid_file_type");
  if (file.size > MEDIA_MAX_BYTES) throw new Error("errors.file_too_large");
  const path = mediaPath(channelId, folder, file.type, crypto.randomUUID());
  const { error } = await createClient()
    .storage.from(MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("errors.upload_failed");
  return path;
}

/** Borra un archivo recién subido si no se pudo registrar. */
export async function discardMedia(path: string) {
  await createClient().storage.from(MEDIA_BUCKET).remove([path]);
}

/** Sube una foto del producto del episodio (`refs/`); la política pide `write_script`. */
export async function uploadEpisodeRef(channelId: string, episodeId: string, file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("errors.invalid_file_type");
  if (file.size > MEDIA_MAX_BYTES) throw new Error("errors.file_too_large");
  const path = episodeRefPath(channelId, episodeId, file.type, crypto.randomUUID());
  const { error } = await createClient()
    .storage.from(MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("errors.upload_failed");
  return path;
}
