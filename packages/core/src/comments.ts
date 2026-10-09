/**
 * Comentarios y dolores de la audiencia (Fase 4 · paso 4, sección 20 de las
 * reglas): los tipos de comentario, las marcas que impiden sugerir respuesta y
 * la lectura del lote de cada episodio, que Audiencia junta por canal.
 */

export const COMMENT_KINDS = [
  "pregunta_tecnica",
  "correccion",
  "desacuerdo",
  "experiencia",
  "pedido_tema",
  "elogio",
  "troll_spam",
] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

/** Con alguna de estas marcas no se sugiere respuesta (20.3). */
export const COMMENT_FLAGS = ["datos_personales", "enlace_sospechoso", "riesgo_legal"] as const;
export type CommentFlag = (typeof COMMENT_FLAGS)[number];

export const REPLY_STATUSES = ["suggested", "edited", "published", "dismissed"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

/** Una corrección de la audiencia: lo que dijo el video, lo correcto y si tiene razón. */
export type CommentCorrection = {
  said: string;
  correct: string;
  source: string;
  /** Minuto del video, si se sabe («4:10»). */
  minute: string;
  valid: boolean;
};

/** La lectura del lote (20.4), acumulada entre lecturas. */
export type CommentReading = {
  themes: { theme: string; count: number }[];
  pains: { pain: string; count: number; quote: string }[];
  /** El dolor mayor, o que todavía hay pocos comentarios para decirlo. */
  topPain: string;
  /** Respuestas a las preguntas del guion (9.2), con su tendencia. */
  questions: { question: string; trend: string }[];
  corrections: string[];
  ideas: string[];
};

export const emptyReading = (): CommentReading => ({
  themes: [],
  pains: [],
  topPain: "",
  questions: [],
  corrections: [],
  ideas: [],
});

/** ¿Se puede sugerir respuesta? No al troll ni a lo marcado. */
export const canSuggestReply = (kind: CommentKind | null, flags: readonly string[]) =>
  kind !== "troll_spam" && flags.length === 0;

/** Lo que Audiencia muestra del canal: las lecturas de cada episodio juntas. */
export type ChannelAudience = {
  pains: { pain: string; count: number; quote: string; episodeId: string; index: number }[];
  themes: { theme: string; count: number }[];
  corrections: { text: string; episodeId: string }[];
  ideas: { text: string; episodeId: string; index: number }[];
};

const key = (s: string) => s.trim().toLowerCase();

/**
 * Junta las lecturas de varios episodios: los dolores van del que más se
 * repite al que menos (cada uno con su episodio, para pasarlo a Ideas), los
 * temas iguales se suman, y las correcciones e ideas se listan con su episodio.
 */
export function channelAudience(
  readings: readonly { episodeId: string; reading: CommentReading }[],
): ChannelAudience {
  const themes = new Map<string, { theme: string; count: number }>();
  const out: ChannelAudience = { pains: [], themes: [], corrections: [], ideas: [] };
  for (const { episodeId, reading } of readings) {
    reading.pains.forEach((p, index) => out.pains.push({ ...p, episodeId, index }));
    for (const t of reading.themes) {
      const cur = themes.get(key(t.theme)) ?? { theme: t.theme, count: 0 };
      cur.count += t.count;
      themes.set(key(t.theme), cur);
    }
    out.corrections.push(...reading.corrections.map((text) => ({ text, episodeId })));
    out.ideas.push(...reading.ideas.map((text, index) => ({ text, episodeId, index })));
  }
  out.pains.sort((a, b) => b.count - a.count);
  out.themes = [...themes.values()].sort((a, b) => b.count - a.count);
  return out;
}

/** Enlace al comentario en YouTube. */
export const commentUrl = (videoId: string, commentId: string) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;
