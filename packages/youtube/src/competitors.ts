import type { VideoInfo, YouTubeClient } from "./api";

/**
 * Competencia (banco de ideas): los canales que sigue el presentador. De cada
 * uno se leen las subidas recientes con sus vistas, para encontrar los videos
 * atípicos (los que superan varias veces la mediana de su canal).
 */

/** Cuántas subidas recientes se leen por canal. */
export const COMPETITOR_RECENT = 30;

export type ChannelRef = { id: string } | { handle: string };

/**
 * Lee un canal desde lo que se pegue: un enlace (youtube.com/@handle,
 * youtube.com/channel/UC…), un @handle o un id UC…. Devuelve null si no se
 * reconoce.
 */
export function parseChannelRef(input: string): ChannelRef | null {
  const raw = input.trim();
  if (!raw) return null;
  const id = /(?:^|\/channel\/)(UC[\w-]{22})(?:[/?#]|$)/.exec(raw);
  if (id) return { id: id[1]! };
  const handle = /(?:^|youtube\.com\/)@([\w.-]{3,30})(?:[/?#]|$)/i.exec(raw);
  if (handle) return { handle: `@${handle[1]}` };
  if (/^[\w.-]{3,30}$/.test(raw) && !raw.includes(".")) return { handle: `@${raw}` };
  return null;
}

/** Las subidas públicas recientes de un canal con sus vistas (1 unidad + 1 por cada 50). */
export async function recentPublicVideos(
  client: YouTubeClient,
  uploadsPlaylistId: string,
  max = COMPETITOR_RECENT,
): Promise<VideoInfo[]> {
  const ids = await client.listRecentUploadIds(uploadsPlaylistId, max);
  if (!ids.length) return [];
  const videos = await client.getVideos(ids);
  return videos.filter((v) => v.privacyStatus === "public" && v.publishedAt);
}
