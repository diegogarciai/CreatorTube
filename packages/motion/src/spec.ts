import {
  beatCreates,
  beatTargets,
  beatTimeline,
  type AidBeat,
  type AidIcon,
  type BeatAction,
  type BrandColors,
  type VisualAid,
} from "@planificador/core";

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

/** Una M con guion de animación se queda en pantalla este tiempo después de la última frase. */
export const MOTION_HOLD_SECONDS = 1;

/**
 * Duración de una ayuda en cuadros. M: lo que tarda en decirse su segmento
 * (más un segundo para leer el cierre); las de antes, su ficha. C: 5 s.
 * L: 2 s por elemento + 1 s.
 */
export function aidDurationFrames(
  aid: Pick<VisualAid, "kind" | "durationS" | "elements"> & { beats?: AidBeat[] },
) {
  const seconds =
    aid.kind === "M"
      ? aid.beats?.length
        ? Math.min(Math.max(aid.durationS ?? 6, 2), 40) + MOTION_HOLD_SECONDS
        : Math.min(Math.max(aid.durationS ?? 6, 2), 30)
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
 * 3: M frase por frase.
 */
export const RENDER_VERSION = 3;

type Span = { start: number; frames: number };

/** Los elementos de una M sin guion de animación entran en el 60 % de su duración. */
const STAGGER_SHARE = 0.6;

/** Cuadros que tarda una acción (entrar, contar, resaltar, viajar, acercarse). */
export const BEAT_FRAMES = 24;
/** Lo primero entra cuando ya está el título. */
export const STORY_LEAD_FRAMES = 6;

/**
 * El guion de animación de una M en cuadros: cuándo entra cada elemento, sus
 * cambios de cifra, cuándo se resalta o se tacha, y los acercamientos y viajes
 * de la cámara. Cada momento empieza cuando se empieza a decir su frase.
 */
export type Story = {
  /** Cuadro en que entra cada elemento. */
  enter: number[];
  /** Cifras nuevas de un elemento (change), en orden. */
  changes: {
    at: number;
    element: number;
    value: string | null;
    unit: string | null;
    icon?: AidIcon | null;
  }[];
  highlight: (number | null)[];
  strike: (number | null)[];
  zooms: { at: number; element: number }[];
  travels: { at: number; from: number; to: number }[];
  /** Cada momento: su cuadro, su acción y el elemento. */
  beats: { at: number; action: BeatAction; element: number | null }[];
  /** ¿Hay guion de animación? (las M de antes entran escalonadas parejo). */
  scripted: boolean;
};

export function storyFor(
  aid: Pick<VisualAid, "elements" | "durationS"> & { beats?: AidBeat[] },
  durationFrames: number,
): Story {
  const n = aid.elements.length;
  const beats = aid.beats ?? [];
  if (!beats.length) {
    const enter = elementStarts(n, durationFrames);
    return {
      enter,
      changes: [],
      highlight: enter.map(() => null),
      strike: enter.map(() => null),
      zooms: [],
      travels: [],
      beats: enter.map((at, i) => ({ at, action: "enter" as const, element: i })),
      scripted: false,
    };
  }
  const speech = Math.max(durationFrames - MOTION_HOLD_SECONDS * FPS, 1);
  const last = Math.max(durationFrames - EXIT_FRAMES - BEAT_FRAMES, 0);
  const times = beatTimeline(beats, speech / FPS);
  const targets = beatTargets(beats);
  const story: Story = {
    enter: [],
    changes: [],
    highlight: Array.from({ length: n }, () => null),
    strike: Array.from({ length: n }, () => null),
    zooms: [],
    travels: [],
    beats: [],
    scripted: true,
  };
  let previous: number | null = null;
  for (const [i, b] of beats.entries()) {
    const at = Math.min(Math.round(times[i]!.start * FPS) + STORY_LEAD_FRAMES, last);
    const el = targets[i] ?? null;
    story.beats.push({ at, action: b.action, element: el });
    if (beatCreates(b)) story.enter.push(at);
    if (el === null || el >= n) continue;
    if (b.action === "change")
      story.changes.push({
        at,
        element: el,
        value: b.value ?? null,
        unit: b.unit ?? null,
        icon: b.icon ?? null,
      });
    if (b.action === "highlight") story.highlight[el] ??= at;
    if (b.action === "strike") story.strike[el] ??= at;
    if (b.action === "zoom") story.zooms.push({ at, element: el });
    if (b.action === "travel" && previous !== null && previous !== el)
      story.travels.push({ at, from: previous, to: el });
    previous = el;
  }
  return story;
}

/** Cuándo entra cada elemento escalonado de una M. */
export function elementStarts(count: number, durationFrames: number) {
  return staggerFrames(count, Math.round(durationFrames * STAGGER_SHARE));
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
  aid: Pick<VisualAid, "kind" | "piece" | "elements" | "durationS"> & { beats?: AidBeat[] },
  durationFrames: number,
): SfxCue[] {
  const n = aid.elements.length;
  const exit = cue(Math.max(durationFrames - EXIT_FRAMES, 0), "out");
  if (aid.kind === "C") return [cue(0, "whoosh"), exit];
  if (aid.kind === "L") {
    return [cue(0, "whoosh"), ...staggerFrames(n, durationFrames).map((f) => cue(f, "pop")), exit];
  }
  return storyCues(aid, durationFrames, exit);
}

/** Los sonidos de una M: uno por momento (o por elemento, en las de antes), con su acción. */
function storyCues(
  aid: Pick<VisualAid, "elements" | "durationS"> & { beats?: AidBeat[] },
  durationFrames: number,
  exit: SfxCue,
): SfxCue[] {
  const story = storyFor(aid, durationFrames);
  const span = (at: number) => ({ start: at, frames: BEAT_FRAMES });
  const body = story.beats.flatMap(({ at, action, element }): SfxCue[] => {
    const counts = element !== null && numericValue(aid.elements[element]?.value) !== null;
    switch (action) {
      case "enter":
        return counts ? [cue(at, "pop"), ...countCues(span(at))] : [cue(at, "pop")];
      case "change":
        return countCues(span(at));
      case "highlight":
      case "strike":
        return [cue(at, "settle")];
      case "zoom":
      case "travel":
        return [cue(at, "whoosh")];
    }
  });
  return [cue(0, "whoosh"), ...body, exit]
    .filter((c) => c.frame >= 0 && c.frame < durationFrames)
    .sort((a, b) => a.frame - b.frame)
    .filter(
      (c, i, all) => !all.slice(0, i).some((o) => o.frame === c.frame && o.sound === c.sound),
    );
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

/** La cifra mientras pasa de `from` a `to` (un cambio de estado), con el formato de `to`. */
export function countedBetween(from: string | null, to: string, progress: number): string {
  const target = numericValue(to);
  if (target === null) return progress < 0.5 && from ? from : to;
  const start = numericValue(from) ?? 0;
  const m = /-?\d+(?:[.,]\d+)?/.exec(to)!;
  const decimals = (m[0].split(/[.,]/)[1] ?? "").length;
  const sep = m[0].includes(",") ? "," : ".";
  const t = Math.min(Math.max(progress, 0), 1);
  const now = (start + (target - start) * t).toFixed(decimals).replace(".", sep);
  return to.replace(m[0], now);
}

/** Mezcla de dos colores #RRGGBB (t = 0 → a, t = 1 → b). */
export function mixColor(a: string, b: string, t: number): string {
  const k = Math.min(Math.max(t, 0), 1);
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
