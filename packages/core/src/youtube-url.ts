const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extrae el ID de un video de YouTube de un enlace pegado (watch, youtu.be,
 * shorts, live, embed, Studio) o de un ID suelto. Devuelve `null` si no es válido.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (VIDEO_ID_RE.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else {
      const m = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname);
      candidate = m?.[1] ?? null;
    }
  } else if (host === "studio.youtube.com") {
    const m = /^\/video\/([^/?#]+)/.exec(url.pathname);
    candidate = m?.[1] ?? null;
  }
  return candidate && VIDEO_ID_RE.test(candidate) ? candidate : null;
}

export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
