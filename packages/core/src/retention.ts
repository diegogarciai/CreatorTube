/**
 * Retención por párrafo del guion (Fase 4 · paso 1). La curva de YouTube
 * (100 puntos, `r` de 0 a 1) se reparte entre los párrafos del guion grabado
 * en proporción a sus palabras: es una estimación, porque el ritmo al hablar
 * no es parejo, pero sirve para ver dónde se va la gente.
 */

export type RetentionPoint = { r: number; watch: number; relative: number | null };

export type ParagraphRetention = {
  index: number;
  text: string;
  words: number;
  /** El tramo del video que le toca (0 a 1). */
  from: number;
  to: number;
  /** Retención al entrar y al salir del párrafo. */
  start: number;
  end: number;
  /** Cuánto se pierde en el párrafo (puntos de retención, 0 a 1). */
  drop: number;
  /** Rendimiento relativo promedio en el tramo (0,5 = la mediana de YouTube). */
  relative: number | null;
  /** Una de las 3 caídas mayores. */
  top: boolean;
};

/** Cantidad de palabras de un párrafo (sin marcas como [PAUSA]). */
export function wordCount(text: string): number {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** La retención en el punto `r`, interpolando entre los puntos de la curva. */
export function retentionAt(points: readonly RetentionPoint[], r: number): number {
  if (!points.length) return 0;
  const sorted = [...points].sort((a, b) => a.r - b.r);
  if (r <= sorted[0]!.r) return sorted[0]!.watch;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (r <= b.r) return a.watch + ((b.watch - a.watch) * (r - a.r)) / (b.r - a.r || 1);
  }
  return sorted.at(-1)!.watch;
}

export const TOP_DROPS = 3;

export function retentionByParagraph(
  points: readonly RetentionPoint[],
  paragraphs: readonly string[],
): ParagraphRetention[] {
  const words = paragraphs.map(wordCount);
  const total = words.reduce((a, b) => a + b, 0);
  if (!points.length || !total) return [];
  let acc = 0;
  const rows = paragraphs.map((text, index) => {
    const from = acc / total;
    acc += words[index]!;
    const to = acc / total;
    const start = retentionAt(points, from);
    const end = retentionAt(points, to);
    const span = points.filter((p) => p.r >= from && p.r <= to && p.relative !== null);
    return {
      index,
      text,
      words: words[index]!,
      from,
      to,
      start,
      end,
      drop: Math.max(start - end, 0),
      relative: span.length ? span.reduce((a, p) => a + (p.relative ?? 0), 0) / span.length : null,
      top: false,
    };
  });
  const top = rows
    .filter((r) => r.words > 0 && r.drop > 0)
    .sort((a, b) => b.drop - a.drop)
    .slice(0, TOP_DROPS)
    .map((r) => r.index);
  return rows.map((r) => ({ ...r, top: top.includes(r.index) }));
}
