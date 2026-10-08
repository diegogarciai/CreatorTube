import type { BrandColors, VisualAid } from "@planificador/core";

/**
 * Lo que comparten la web, las tareas y las composiciones de Remotion: los
 * formatos de render, las props y los tiempos. Sin React, para que el motor de
 * tareas lo importe sin cargar las composiciones.
 */

export const FPS = 30;

export const AID_FORMATS = ["horizontal", "vertical", "green", "alpha"] as const;
export type AidFormat = (typeof AID_FORMATS)[number];

/** Los formatos que se renderizan de una ayuda (M en video; C y L en verde y transparente). */
export function formatsFor(aid: Pick<VisualAid, "kind" | "vertical">): AidFormat[] {
  if (aid.kind === "M") return aid.vertical ? ["horizontal", "vertical"] : ["horizontal"];
  return ["green", "alpha"];
}

export const COMPOSITIONS = {
  motion: "MotionAid",
  motionVertical: "MotionAidVertical",
  concept: "ConceptLabel",
  list: "ListAid",
} as const;

export type AidBackground = "brand" | "green" | "transparent";

export type AidProps = {
  aid: VisualAid;
  colors: BrandColors;
  background: AidBackground;
};

/** La composición, las props y el archivo de cada formato. */
export function renderSpec(
  aid: VisualAid,
  colors: BrandColors,
  format: AidFormat,
): {
  composition: string;
  props: AidProps;
  codec: "h264" | "vp9";
  extension: "mp4" | "webm";
  mime: "video/mp4" | "video/webm";
  alpha: boolean;
} {
  const alpha = format === "alpha";
  const composition =
    aid.kind === "M"
      ? format === "vertical"
        ? COMPOSITIONS.motionVertical
        : COMPOSITIONS.motion
      : aid.kind === "C"
        ? COMPOSITIONS.concept
        : COMPOSITIONS.list;
  return {
    composition,
    props: {
      aid,
      colors,
      background: aid.kind === "M" ? "brand" : alpha ? "transparent" : "green",
    },
    codec: alpha ? "vp9" : "h264",
    extension: alpha ? "webm" : "mp4",
    mime: alpha ? "video/webm" : "video/mp4",
    alpha,
  };
}

export const CONCEPT_SECONDS = 5;
export const LIST_SECONDS_PER_ITEM = 2;
/** Entrada y salida de cada pieza, en cuadros. */
export const ENTER_FRAMES = 18;
export const EXIT_FRAMES = 12;

/** Duración de una ayuda en cuadros (M: su ficha; C: 5 s; L: 2 s por elemento + 1 s). */
export function aidDurationFrames(aid: Pick<VisualAid, "kind" | "durationS" | "elements">) {
  const seconds =
    aid.kind === "M"
      ? Math.min(Math.max(aid.durationS ?? 6, 2), 30)
      : aid.kind === "C"
        ? CONCEPT_SECONDS
        : LIST_SECONDS_PER_ITEM * Math.max(aid.elements.length, 1) + 1;
  return Math.round(seconds * FPS);
}

/** Cuándo entra cada elemento: repartidos en el tiempo que queda antes de la salida. */
export function staggerFrames(count: number, durationFrames: number, start = ENTER_FRAMES) {
  if (count <= 0) return [];
  const usable = Math.max(durationFrames - start - EXIT_FRAMES - ENTER_FRAMES, count);
  const step = count > 1 ? usable / count : 0;
  return Array.from({ length: count }, (_, i) => Math.round(start + i * step));
}

/** La cifra de un elemento como número («$199» → 199, «40 %» → 40, «3×» → 3). */
export function numericValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(value.replace(/\s/g, ""));
  if (!m) return null;
  return Number(m[0].replace(",", "."));
}

/**
 * Alturas relativas de barras desde cero (12.3): la mayor llena el espacio y
 * las demás en proporción; sin cifras, todas iguales.
 */
export function barScale(values: readonly (number | null)[]): number[] {
  const nums = values.map((v) => (v === null || !Number.isFinite(v) ? 0 : Math.max(v, 0)));
  const max = Math.max(...nums, 0);
  if (max === 0) return values.map(() => 1);
  return nums.map((n) => n / max);
}

/** El número mostrado mientras cuenta: con los decimales y el formato del original. */
export function countedText(value: string, progress: number): string {
  const target = numericValue(value);
  if (target === null) return value;
  const m = /-?\d+(?:[.,]\d+)?/.exec(value)!;
  const decimals = (m[0].split(/[.,]/)[1] ?? "").length;
  const sep = m[0].includes(",") ? "," : ".";
  const now = (target * Math.min(Math.max(progress, 0), 1)).toFixed(decimals).replace(".", sep);
  return value.replace(m[0], now);
}
