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

/**
 * Versión de los renders: sube cuando cambia lo que sale en el video, para que
 * los renders anteriores se marquen desactualizados. 2: con efectos de sonido.
 */
export const RENDER_VERSION = 2;

type Span = { start: number; frames: number };

/** Los tiempos de cada pieza, en cuadros: la imagen y el sonido salen de aquí. */
export const PIECE_TIMING = {
  /** Los elementos escalonados entran repartidos en el 60 % de la duración, 24 cuadros cada uno. */
  stagger: { share: 0.6, frames: 24 },
  ring: { start: 6, frames: 40 },
  counter: { start: 4, frames: 50 },
  timelineLine: { start: 0, frames: 40 },
  /** Los puntos se encienden uno cada 0,6 cuadros desde el cuadro 8. */
  dotMatrix: { start: 8, perDot: 0.6 },
  curve: { start: 6, frames: 60 },
  beforeAfter: { first: { start: 0, frames: 24 }, wipe: { start: 20, frames: 36 } },
  networkCenter: { start: 0, frames: 24 },
  zoomFocus: { start: 10, frames: 30 },
} as const satisfies Record<string, Span | Record<string, number | Span>>;

/** Cuándo entra cada elemento escalonado de una M. */
export function elementStarts(count: number, durationFrames: number) {
  return staggerFrames(count, Math.round(durationFrames * PIECE_TIMING.stagger.share));
}

/** La curva de la marca, cubic-bezier(0.2, 0, 0, 1), sin Remotion (para los cues). */
export function brandProgress(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const [x1, y1, x2, y2] = [0.2, 0, 0, 1];
  const bez = (u: number, a: number, b: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  // Bisección sobre x (monótona): u tal que x(u) = t.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, x1, x2) < t) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, y1, y2);
}

/** El primer cuadro de `span` en que la curva de la marca llega a `p`. */
export function frameAtProgress(span: Span, p: number) {
  for (let f = 0; f <= span.frames; f++) {
    if (brandProgress(f / span.frames) >= p - 1e-9) return span.start + f;
  }
  return span.start + span.frames;
}

export type SfxCue = {
  frame: number;
  sound: "whoosh" | "pop" | "tick" | "settle" | "out";
  volume: number;
};

const VOLUME = { whoosh: 0.45, pop: 0.5, tick: 0.3, settle: 0.55, out: 0.35 } as const;
/** Los tics de una cifra que cuenta: como mucho, uno cada 3 cuadros. */
const TICK_GAP = 3;
const TICK_STEPS = 12;

/** Tics mientras cuenta (cuando la cifra avanza un doceavo) y un golpe al llegar. */
function countCues(span: Span): SfxCue[] {
  const cues: SfxCue[] = [];
  let last = -Infinity;
  for (let k = 1; k < TICK_STEPS; k++) {
    const f = frameAtProgress(span, k / TICK_STEPS);
    if (f - last >= TICK_GAP) {
      cues.push({ frame: f, sound: "tick", volume: VOLUME.tick });
      last = f;
    }
  }
  return [...cues, { frame: span.start + span.frames, sound: "settle", volume: VOLUME.settle }];
}

const cue = (frame: number, sound: SfxCue["sound"]): SfxCue => ({
  frame,
  sound,
  volume: VOLUME[sound],
});

/**
 * Los efectos de sonido de una ayuda, sincronizados con su animación: entrada
 * (whoosh), cada elemento que aparece (pop), la cifra que cuenta (tics y un
 * golpe al llegar) y la salida.
 */
export function sfxCues(
  aid: Pick<VisualAid, "kind" | "piece" | "elements">,
  durationFrames: number,
): SfxCue[] {
  const n = aid.elements.length;
  const exit = cue(Math.max(durationFrames - EXIT_FRAMES, 0), "out");
  if (aid.kind === "C") return [cue(0, "whoosh"), exit];
  if (aid.kind === "L") {
    return [cue(0, "whoosh"), ...staggerFrames(n, durationFrames).map((f) => cue(f, "pop")), exit];
  }
  const pops = (from = 0) =>
    elementStarts(n, durationFrames)
      .slice(from)
      .map((f) => cue(f, "pop"));
  const hasValue = numericValue(aid.elements[0]?.value) !== null;
  const t = PIECE_TIMING;
  let body: SfxCue[];
  switch (aid.piece ?? "counter") {
    case "bars":
    case "comparison":
    case "timeline":
    case "network":
      body = pops();
      break;
    case "ring":
      body = hasValue ? countCues(t.ring) : [cue(t.ring.start + t.ring.frames, "settle")];
      break;
    case "counter":
      body = [...(hasValue ? countCues(t.counter) : []), ...pops(1)];
      break;
    case "dot_matrix": {
      const lit = Math.round(
        Math.min(Math.max(numericValue(aid.elements[0]?.value) ?? 50, 0), 100),
      );
      const end = t.dotMatrix.start + Math.ceil(lit * t.dotMatrix.perDot);
      body = [];
      for (let f = t.dotMatrix.start + 1; f < end; f += TICK_GAP) body.push(cue(f, "tick"));
      body.push(cue(end, "settle"));
      break;
    }
    case "curve":
      // Cada punto aparece cuando el trazo llega a él.
      body = aid.elements.map((_, i) =>
        cue(frameAtProgress(t.curve, n > 1 ? i / (n - 1) : 0), "pop"),
      );
      break;
    case "before_after":
      body = [cue(t.beforeAfter.wipe.start, "settle")];
      break;
    case "zoom":
      body = [cue(t.zoomFocus.start, "settle"), ...pops(1)];
      break;
  }
  return [cue(0, "whoosh"), ...body, exit]
    .filter((c) => c.frame >= 0 && c.frame < durationFrames)
    .sort((a, b) => a.frame - b.frame);
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
