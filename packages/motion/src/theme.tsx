import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { BrandColors } from "@planificador/core";
import { ENTER_FRAMES, EXIT_FRAMES } from "./spec";

/** La curva de movimiento del manual: sin rebotes, giros, brillos ni glitch. */
export const brandEase = Easing.bezier(0.2, 0, 0, 1);

export const SANS = "Inter, sans-serif";
export const MONO = "'JetBrains Mono', monospace";

/** Las fuentes van con el bundle (OFL); el render espera a que carguen. */
const FONTS: { family: string; file: string; weight: string; range?: string }[] = [
  { family: "Inter", file: "fonts/inter-latin-opsz-normal.woff2", weight: "100 900" },
  {
    family: "Inter",
    file: "fonts/inter-latin-ext-opsz-normal.woff2",
    weight: "100 900",
    range: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1EFF",
  },
  { family: "JetBrains Mono", file: "fonts/jetbrains-mono-latin-400-normal.woff2", weight: "400" },
  { family: "JetBrains Mono", file: "fonts/jetbrains-mono-latin-600-normal.woff2", weight: "600" },
];

let fontsRequested = false;
export function loadBrandFonts() {
  if (fontsRequested || typeof document === "undefined") return;
  fontsRequested = true;
  const handle = delayRender("Cargando las fuentes de la marca");
  Promise.all(
    FONTS.map((f) =>
      new FontFace(f.family, `url(${staticFile(f.file)}) format("woff2")`, {
        weight: f.weight,
        ...(f.range ? { unicodeRange: f.range } : {}),
      })
        .load()
        .then((face) => document.fonts.add(face)),
    ),
  )
    .then(() => continueRender(handle))
    .catch((err: unknown) => {
      console.error(err);
      continueRender(handle);
    });
}

/** Un color con opacidad (#RRGGBB + alfa). */
export const alpha = (hex: string, a: number) =>
  `${hex}${Math.round(Math.min(Math.max(a, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0")}`;

/** Entrada (0 → 1) con la curva de la marca, desde el cuadro `start`. */
export function useEnter(start = 0, frames = ENTER_FRAMES) {
  const frame = useCurrentFrame();
  return interpolate(frame, [start, start + frames], [0, 1], {
    easing: brandEase,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Salida al final de la pieza (1 → 0). */
export function useExit(frames = EXIT_FRAMES) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return interpolate(frame, [durationInFrames - frames, durationInFrames], [1, 0], {
    easing: brandEase,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export type Layout = {
  width: number;
  height: number;
  vertical: boolean;
  /** Caja útil: margen de 96 × 72 en horizontal; zona segura 250/340/120 en vertical. */
  box: { x: number; y: number; w: number; h: number };
  /** Escala tipográfica del manual. */
  type: { display: number; title: number; sub: number; body: number; mono: number; value: number };
};

export function useLayout(): Layout {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const box = vertical
    ? { x: 72, y: 250, w: width - 72 - 120, h: height - 250 - 340 }
    : { x: 96, y: 72, w: width - 192, h: height - 144 };
  return {
    width,
    height,
    vertical,
    box,
    type: vertical
      ? { display: 96, title: 72, sub: 48, body: 40, mono: 28, value: 64 }
      : { display: 64, title: 56, sub: 32, body: 28, mono: 22, value: 40 },
  };
}

/** Fondo de marca de una M: lienzo, retícula al 6 % (hay datos) y viñeteado; sin halo detrás de datos. */
export function BrandBackground({ colors, data }: { colors: BrandColors; data: boolean }) {
  const cell = 80;
  // Fondo sutilmente animado (12.6): la retícula se desliza despacio.
  const frame = useCurrentFrame();
  const drift = (frame * 0.25) % cell;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.canvas }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${alpha(colors.grid, data ? 0.06 : 0.1)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(colors.grid, data ? 0.06 : 0.1)} 1px, transparent 1px)`,
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: `${drift}px ${drift / 2}px`,
        }}
      />
      {data ? null : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 60% 50%, ${alpha(colors.glow, 0.55)} 0%, ${alpha(colors.amberDeep, 0.28)} 30%, transparent 60%)`,
          }}
        />
      )}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, transparent 55%, ${alpha("#000000", 0.55)} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
}

export function Text({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontOpticalSizing: "auto",
        letterSpacing: "-0.01em",
        lineHeight: 1.1,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
