import type { CommentInfo, YouTubeClient } from "./api";

/**
 * Comentarios de un video para responder (Fase 4 · paso 4): trae los hilos del
 * más nuevo al más viejo hasta encontrar uno ya leído o llegar al tope, así
 * cada lectura solo gasta lo nuevo (1 unidad por página de 100).
 */
export async function fetchNewComments(
  client: Pick<YouTubeClient, "listCommentThreads">,
  videoId: string,
  opts: { knownIds: ReadonlySet<string>; channelYouTubeId: string | null; max?: number },
): Promise<CommentInfo[]> {
  const max = opts.max ?? 300;
  const out: CommentInfo[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.listCommentThreads(videoId, {
      pageToken,
      channelYouTubeId: opts.channelYouTubeId,
    });
    for (const c of page.comments) {
      if (opts.knownIds.has(c.id)) return out;
      // Los del propio canal no se responden.
      if (opts.channelYouTubeId && c.authorChannelId === opts.channelYouTubeId) continue;
      out.push(c);
      if (out.length >= max) return out;
    }
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}
