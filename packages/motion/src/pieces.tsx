import type { CSSProperties, ReactElement, ReactNode } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { AidElement, AidIcon, AidPiece, BrandColors } from "@planificador/core";
import { AidIconView } from "./icons";
import {
  BEAT_FRAMES,
  barScale,
  countedBetween,
  countedText,
  mixColor,
  numericValue,
  type Story,
} from "./spec";
import { alpha, brandEase, MONO, Text, type Layout } from "./theme";

/**
 * Las piezas de marca de las M (regla 12.2). Cada una arma sus elementos sobre
 * un mismo lienzo, en el área que le dejan el título y el pie, al ritmo del
 * guion de animación: cada elemento entra cuando se dice su frase, y después
 * cambia de cifra, se resalta o se tacha en su momento. Serie de referencia en
 * Crema al 35 %, lo que importa en Naranja marca, cifras en JetBrains Mono.
 */

export type Area = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };
export type PieceProps = {
  elements: AidElement[];
  colors: BrandColors;
  layout: Layout;
  area: Area;
  story: Story;
};

/** El estado de un elemento en el cuadro actual. */
export type ElState = {
  /** Entrada, de 0 a 1. */
  p: number;
  /** La cifra con su unidad, contando. */
  value: string;
  /** La cifra como número en este cuadro (para alturas, anillos y puntos). */
  num: number | null;
  /** Resaltado (0 a 1) y tachado (0 a 1). */
  hl: number;
  st: number;
  /** Color del texto y del relleno: de Crema a Naranja marca según el resaltado. */
  color: string;
  fill: string;
  /** El ícono en este cuadro y su escala (se encoge y vuelve al cambiar de estado). */
  icon: AidIcon | null;
  iconScale: number;
};

const valueOf = (value: string | null | undefined, unit: string | null | undefined) =>
  [value, unit].filter(Boolean).join(" ");

/** El estado de cada elemento: entra contando, cambia de cifra, se resalta o se tacha. */
export function useStates(elements: AidElement[], story: Story, colors: BrandColors): ElState[] {
  const frame = useCurrentFrame();
  const ease = (from: number, frames = BEAT_FRAMES) =>
    interpolate(frame, [from, from + frames], [0, 1], {
      easing: brandEase,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const anyHighlight = story.highlight.some((h) => h !== null);
  const reference = mixColor(colors.canvas, colors.cream, 0.35);
  return elements.map((e, i) => {
    const p = ease(story.enter[i] ?? 0);
    let current = valueOf(e.value, e.unit);
    let target = numericValue(e.value);
    let shown = e.value ? countedText(current, p) : current;
    let num = target === null ? null : target * p;
    let icon = e.icon ?? null;
    let iconScale = 1;
    for (const c of story.changes) {
      if (c.element !== i || c.at > frame) continue;
      const q = ease(c.at);
      if (c.value) {
        const next = valueOf(c.value, c.unit ?? e.unit);
        const to = numericValue(c.value);
        shown = countedBetween(current, next, q);
        num = to === null ? num : (target ?? 0) + (to - (target ?? 0)) * q;
        current = next;
        target = to ?? target;
      }
      if (c.icon && c.icon !== icon) {
        // A mitad del cambio el ícono se encoge y entra el nuevo.
        iconScale = q < 0.5 ? 1 - q : q;
        if (q >= 0.5) icon = c.icon;
      }
    }
    const at = story.highlight[i];
    // Sin resaltados en el guion, lo principal (el primero) va en Naranja marca.
    const hl = at != null ? ease(at, 18) : !anyHighlight && i === 0 ? 1 : 0;
    const st = story.strike[i] != null ? ease(story.strike[i]!, 18) : 0;
    return {
      p,
      value: shown,
      num,
      hl,
      st,
      color: mixColor(colors.cream, colors.accent, hl),
      fill: mixColor(reference, colors.accent, hl),
      icon,
      iconScale,
    };
  });
}

/** El ícono de un elemento con su color y su escala del momento. */
function StateIcon({
  s,
  size,
  style,
}: {
  s: ElState | undefined;
  size: number;
  style?: CSSProperties;
}) {
  if (!s?.icon) return null;
  return (
    <AidIconView
      name={s.icon}
      size={size}
      color={s.color}
      style={{ display: "block", transform: `scale(${s.iconScale})`, ...style }}
    />
  );
}

/** Un texto que se puede tachar (mito): una raya que lo cruza y lo apaga. */
function Struck({
  st,
  colors,
  children,
  style,
}: {
  st: number;
  colors: BrandColors;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <div style={{ opacity: 1 - 0.5 * st }}>{children}</div>
      {st > 0 ? (
        <div
          style={{
            position: "absolute",
            left: "-4%",
            top: "52%",
            height: 6,
            width: `${108 * st}%`,
            background: colors.accent,
            borderRadius: 3,
          }}
        />
      ) : null}
    </div>
  );
}

const rise = (p: number, px = 24): CSSProperties => ({
  opacity: p,
  transform: `translateY(${(1 - p) * px}px)`,
});

/* ---------- Barras ---------- */

function barsGeometry(n: number, layout: Layout, area: Area) {
  const gap = layout.vertical ? 32 : 48;
  const count = Math.max(n, 1);
  const barW = Math.min((area.w - gap * (count - 1)) / count, layout.vertical ? 260 : 280);
  const total = barW * count + gap * (count - 1);
  const labelH = layout.type.body * 2.6;
  const maxH = area.h - labelH - layout.type.value * 1.6;
  return { gap, barW, total, labelH, maxH, left: area.x + (area.w - total) / 2 };
}

function Bars({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const g = barsGeometry(elements.length, layout, area);
  const scale = barScale(s.map((x) => (x.num === null ? null : Math.max(x.num, 0))));
  return (
    <div
      style={{ position: "absolute", left: g.left, top: area.y, width: g.total, height: area.h }}
    >
      {/* Eje en cero. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: area.h - g.labelH,
          height: 2,
          background: alpha(colors.cream, 0.2),
        }}
      />
      {elements.map((e, i) => {
        // Con cifra, la barra crece mientras cuenta (y las demás se reescalan con la mayor).
        const h = g.maxH * scale[i]! * (s[i]!.num === null ? s[i]!.p : 1);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i * (g.barW + g.gap),
              width: g.barW,
              top: 0,
              height: area.h,
            }}
          >
            <div
              style={{
                position: "absolute",
                bottom: g.labelH,
                width: g.barW,
                height: h,
                background: s[i]!.fill,
                borderRadius: "6px 6px 0 0",
                display: "flex",
                justifyContent: "center",
                alignItems: "flex-end",
                paddingBottom: 20,
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              {/* El ícono va dentro de la barra, al pie, en el color del lienzo. */}
              {h > Math.min(g.barW * 0.5, 120) ? (
                <StateIcon
                  s={s[i] && { ...s[i]!, color: colors.canvas }}
                  size={Math.min(g.barW * 0.45, 96)}
                />
              ) : null}
            </div>
            <div
              style={{
                position: "absolute",
                bottom: g.labelH + h + 12,
                width: g.barW,
                textAlign: "center",
                fontFamily: MONO,
                fontSize: layout.type.value,
                color: s[i]!.color,
                opacity: s[i]!.p,
              }}
            >
              {s[i]!.value}
            </div>
            <Text
              style={{
                position: "absolute",
                top: area.h - g.labelH + 16,
                width: g.barW,
                textAlign: "center",
                fontSize: layout.type.body,
                color: colors.text,
                opacity: s[i]!.p,
              }}
            >
              <Struck st={s[i]!.st} colors={colors}>
                {e.text}
              </Struck>
            </Text>
          </div>
        );
      })}
    </div>
  );
}

const barsAnchors = (n: number, layout: Layout, area: Area): Pt[] => {
  const g = barsGeometry(n, layout, area);
  return Array.from({ length: n }, (_, i) => ({
    x: g.left + i * (g.barW + g.gap) + g.barW / 2,
    y: area.y + area.h - g.labelH - g.maxH / 2,
  }));
};

/* ---------- Anillo ---------- */

function ringGeometry(n: number, area: Area) {
  const size = Math.min(area.w, area.h) * (n > 1 ? 0.62 : 0.78);
  return {
    size,
    left: area.x + (area.w - size) / 2,
    top: area.y + (n > 1 ? 0 : (area.h - size) / 2),
  };
}

function Ring({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const g = ringGeometry(elements.length, area);
  const main = elements[0];
  const pct = Math.min(Math.max(s[0]?.num ?? 100 * (s[0]?.p ?? 0), 0), 100) / 100;
  const r = g.size / 2 - 24;
  const c = 2 * Math.PI * r;
  return (
    <>
      <div
        style={{ position: "absolute", left: g.left, top: g.top, width: g.size, height: g.size }}
      >
        <svg width={g.size} height={g.size}>
          <circle
            cx={g.size / 2}
            cy={g.size / 2}
            r={r}
            fill="none"
            stroke={alpha(colors.cream, 0.2)}
            strokeWidth={28}
          />
          <circle
            cx={g.size / 2}
            cy={g.size / 2}
            r={r}
            fill="none"
            stroke={s[0]?.hl ? s[0].fill : colors.accent}
            strokeWidth={28}
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform={`rotate(-90 ${g.size / 2} ${g.size / 2})`}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            opacity: s[0]?.p,
          }}
        >
          <StateIcon s={s[0] && { ...s[0], color: colors.accent }} size={g.size * 0.16} />
          <div
            style={{
              fontFamily: MONO,
              fontWeight: 600,
              fontSize: layout.type.value * 2,
              color: colors.accent,
            }}
          >
            {main?.value ? s[0]!.value : ""}
          </div>
          <Text
            style={{
              fontSize: layout.type.sub,
              color: colors.text,
              textAlign: "center",
              maxWidth: g.size * 0.7,
            }}
          >
            {main?.text}
          </Text>
        </div>
      </div>
      <Rest
        elements={elements}
        s={s}
        colors={colors}
        layout={layout}
        area={area}
        top={g.top + g.size + 32}
      />
    </>
  );
}

/** Los elementos que acompañan a la cifra principal, en líneas debajo. */
function Rest({
  elements,
  s,
  colors,
  layout,
  area,
  top,
}: {
  elements: AidElement[];
  s: ElState[];
  colors: BrandColors;
  layout: Layout;
  area: Area;
  top: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: area.x,
        top,
        width: area.w,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
      }}
    >
      {elements.slice(1).map((e, i) => (
        <Text
          key={i}
          style={{
            fontSize: layout.type.sub,
            color: s[i + 1]!.color,
            display: "flex",
            alignItems: "center",
            gap: 16,
            ...rise(s[i + 1]!.p),
          }}
        >
          <StateIcon s={s[i + 1]} size={layout.type.sub * 1.3} />
          <Struck st={s[i + 1]!.st} colors={colors}>
            {[s[i + 1]!.value, e.text].filter(Boolean).join(" · ")}
          </Struck>
        </Text>
      ))}
    </div>
  );
}

const restAnchors = (n: number, layout: Layout, area: Area, top: number, main: Pt): Pt[] =>
  Array.from({ length: n }, (_, i) =>
    i === 0
      ? main
      : { x: area.x + area.w / 2, y: top + (i - 1) * (layout.type.sub * 1.1 + 16) + 20 },
  );

const ringAnchors = (n: number, layout: Layout, area: Area): Pt[] => {
  const g = ringGeometry(n, area);
  return restAnchors(n, layout, area, g.top + g.size + 32, {
    x: g.left + g.size / 2,
    y: g.top + g.size / 2,
  });
};

/* ---------- Cifra que cuenta ---------- */

function Counter({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const [main, ...rest] = elements;
  return (
    <div
      style={{
        position: "absolute",
        left: area.x,
        top: area.y,
        width: area.w,
        height: area.h,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontWeight: 600,
          fontSize: layout.vertical ? 200 : 220,
          lineHeight: 1,
          color: colors.accent,
          display: "flex",
          alignItems: "center",
          gap: 40,
          ...rise(s[0]?.p ?? 0),
        }}
      >
        <StateIcon
          s={s[0] && { ...s[0], color: colors.accent }}
          size={layout.vertical ? 140 : 170}
        />
        <Struck st={s[0]?.st ?? 0} colors={colors}>
          {main?.value ? s[0]!.value : main?.text}
        </Struck>
      </div>
      {main?.value ? (
        <Text
          style={{
            fontSize: layout.type.title,
            color: colors.text,
            fontWeight: 600,
            opacity: s[0]?.p,
          }}
        >
          {main.text}
        </Text>
      ) : null}
      {rest.map((e, i) => (
        <Text
          key={i}
          style={{
            fontSize: layout.type.sub,
            color: s[i + 1]!.color,
            display: "flex",
            alignItems: "center",
            gap: 16,
            ...rise(s[i + 1]!.p),
          }}
        >
          <StateIcon s={s[i + 1]} size={layout.type.sub * 1.3} />
          <Struck st={s[i + 1]!.st} colors={colors}>
            {[s[i + 1]!.value, e.text].filter(Boolean).join(" · ")}
          </Struck>
        </Text>
      ))}
    </div>
  );
}

const centerColumnAnchors = (n: number, layout: Layout, area: Area): Pt[] => {
  const mainH = (layout.vertical ? 200 : 220) + layout.type.title * 1.1 + 24;
  const restH = (n - 1) * (layout.type.sub * 1.1 + 24);
  const top = area.y + (area.h - mainH - restH) / 2;
  return Array.from({ length: n }, (_, i) =>
    i === 0
      ? { x: area.x + area.w / 2, y: top + mainH / 2 }
      : { x: area.x + area.w / 2, y: top + mainH + 24 + (i - 1) * (layout.type.sub * 1.1 + 24) },
  );
};

/* ---------- Línea de tiempo ---------- */

const timelinePoint = (i: number, n: number, layout: Layout, area: Area): Pt => {
  const t = n > 1 ? i / (n - 1) : 0.5;
  return layout.vertical
    ? { x: area.x + 42, y: area.y + t * (area.h - 120) + 14 }
    : { x: area.x + t * (area.w - 280) + 140, y: area.y + area.h / 2 };
};

function Timeline({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const n = Math.max(elements.length, 1);
  const vertical = layout.vertical;
  // La línea avanza hasta el último hito que ya entró.
  const reach = s.reduce((acc, x, i) => (x.p > 0 ? Math.max(acc, (i + x.p) / n) : acc), 0);
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }}>
      <div
        style={
          vertical
            ? {
                position: "absolute",
                left: 40,
                top: 0,
                width: 4,
                height: area.h * reach,
                background: alpha(colors.cream, 0.35),
              }
            : {
                position: "absolute",
                top: area.h / 2,
                left: 0,
                height: 4,
                width: area.w * reach,
                background: alpha(colors.cream, 0.35),
              }
        }
      />
      {elements.map((e, i) => {
        const pt = timelinePoint(i, n, layout, area);
        const x = pt.x - area.x;
        const y = pt.y - area.y;
        const dot = s[i]!.icon
          ? null
          : {
              width: 28,
              height: 28,
              borderRadius: 14,
              background: s[i]!.color,
              transform: `scale(${0.4 + 0.6 * s[i]!.p})`,
            };
        // Con ícono, el hito es el objeto: el ícono sobre un disco del lienzo.
        const marker = dot ? (
          <div style={dot} />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              position: "relative",
              transform: `scale(${0.6 + 0.4 * s[i]!.p})`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: -26,
                top: -26,
                width: 80,
                height: 80,
                borderRadius: 40,
                background: colors.canvas,
                border: `2px solid ${s[i]!.color}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <StateIcon s={s[i]} size={46} />
            </div>
          </div>
        );
        return vertical ? (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 28,
              top: y - 14,
              display: "flex",
              gap: 32,
              alignItems: "center",
              opacity: s[i]!.p,
            }}
          >
            {marker}
            <div>
              <div
                style={{ fontFamily: MONO, fontSize: layout.type.mono * 1.6, color: s[i]!.color }}
              >
                {s[i]!.value}
              </div>
              <Text style={{ fontSize: layout.type.body, color: colors.text }}>
                <Struck st={s[i]!.st} colors={colors}>
                  {e.text}
                </Struck>
              </Text>
            </div>
          </div>
        ) : (
          <div
            key={i}
            style={{ position: "absolute", top: y - 14, left: x - 14, opacity: s[i]!.p }}
          >
            {marker}
            <div
              style={{
                position: "absolute",
                bottom: 56,
                left: -140,
                width: 308,
                textAlign: "center",
                fontFamily: MONO,
                fontSize: layout.type.value,
                color: s[i]!.color,
              }}
            >
              {s[i]!.value}
            </div>
            <Text
              style={{
                position: "absolute",
                top: 56,
                left: -140,
                width: 308,
                textAlign: "center",
                fontSize: layout.type.body,
                color: colors.text,
              }}
            >
              <Struck st={s[i]!.st} colors={colors}>
                {e.text}
              </Struck>
            </Text>
          </div>
        );
      })}
    </div>
  );
}

const timelineAnchors = (n: number, layout: Layout, area: Area): Pt[] =>
  Array.from({ length: n }, (_, i) => timelinePoint(i, n, layout, area));

/* ---------- Matriz de puntos ---------- */

function dotGeometry(layout: Layout, area: Area) {
  const size = Math.min(area.h * 0.8, layout.vertical ? area.w : area.w * 0.45);
  const textW = layout.vertical ? area.w : area.w - size - 80;
  const total = layout.vertical ? size : size + 80 + textW;
  return { size, textW, left: area.x + (area.w - total) / 2 };
}

function DotMatrix({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const main = elements[0];
  const lit = Math.round(Math.min(Math.max(s[0]?.num ?? 50 * (s[0]?.p ?? 0), 0), 100));
  const cols = 10;
  const g = dotGeometry(layout, area);
  const cell = g.size / cols;
  return (
    <div
      style={{
        position: "absolute",
        left: area.x,
        top: area.y,
        width: area.w,
        height: area.h,
        display: "flex",
        flexDirection: layout.vertical ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 80,
      }}
    >
      <svg width={g.size} height={g.size}>
        {Array.from({ length: 100 }, (_, i) => (
          <circle
            key={i}
            cx={(i % cols) * cell + cell / 2}
            cy={Math.floor(i / cols) * cell + cell / 2}
            r={cell * 0.32}
            fill={i < lit ? colors.accent : alpha(colors.cream, 0.15)}
          />
        ))}
      </svg>
      <div style={{ width: g.textW }}>
        <div
          style={{
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: layout.type.value * 2.4,
            color: colors.accent,
            opacity: s[0]?.p,
          }}
        >
          {main?.value ? s[0]!.value : ""}
        </div>
        <Text
          style={{
            fontSize: layout.type.title,
            color: colors.text,
            fontWeight: 600,
            opacity: s[0]?.p,
          }}
        >
          {main?.text}
        </Text>
        {elements.slice(1).map((e, i) => (
          <Text
            key={i}
            style={{
              fontSize: layout.type.sub,
              color: s[i + 1]!.color,
              marginTop: 16,
              ...rise(s[i + 1]!.p),
            }}
          >
            <Struck st={s[i + 1]!.st} colors={colors}>
              {[s[i + 1]!.value, e.text].filter(Boolean).join(" · ")}
            </Struck>
          </Text>
        ))}
      </div>
    </div>
  );
}

const dotAnchors = (n: number, layout: Layout, area: Area): Pt[] => {
  const g = dotGeometry(layout, area);
  const grid = layout.vertical
    ? { x: area.x + area.w / 2, y: area.y + area.h / 2 - g.size / 2 }
    : { x: g.left + g.size / 2, y: area.y + area.h / 2 };
  const textX = layout.vertical ? area.x + area.w / 2 : g.left + g.size + 80 + g.textW / 2;
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? grid : { x: textX, y: area.y + area.h / 2 + i * (layout.type.sub * 1.1 + 16) },
  );
};

/* ---------- Curva ---------- */

function curveGeometry(values: number[], layout: Layout, area: Area) {
  const max = Math.max(...values, 1);
  const labelH = layout.type.body * 2.4;
  const h = area.h - labelH - layout.type.value * 1.5;
  const n = Math.max(values.length, 2);
  // Margen a los lados para que las etiquetas de los extremos no se corten.
  const inset = 150;
  const pts = values.map((v, i) => ({
    x: inset + (i / (n - 1)) * (area.w - inset * 2),
    y: layout.type.value * 1.5 + h - (Math.max(v, 0) / max) * h,
  }));
  return { pts, h, labelH };
}

function Curve({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const g = curveGeometry(
    elements.map((e) => numericValue(e.value) ?? 0),
    layout,
    area,
  );
  // El trazo llega hasta el último punto que ya entró.
  const reach = s.reduce((acc, x, i) => (x.p > 0 ? Math.max(acc, i - 1 + x.p) : acc), 0);
  const segs = g.pts.slice(1).map((p, i) => Math.hypot(p.x - g.pts[i]!.x, p.y - g.pts[i]!.y));
  const len = segs.reduce((a, b) => a + b, 0) || 1;
  const drawn = segs.reduce((acc, seg, i) => acc + seg * Math.min(Math.max(reach - i, 0), 1), 0);
  const d = g.pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }}>
      <svg width={area.w} height={area.h} style={{ overflow: "visible" }}>
        <line
          x1={0}
          x2={area.w}
          y1={layout.type.value * 1.5 + g.h}
          y2={layout.type.value * 1.5 + g.h}
          stroke={alpha(colors.cream, 0.2)}
          strokeWidth={2}
        />
        <path
          d={d}
          fill="none"
          stroke={colors.accent}
          strokeWidth={8}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={`${drawn} ${len}`}
        />
        {g.pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={12 * s[i]!.p} fill={s[i]!.color} />
        ))}
      </svg>
      {elements.map((e, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 0,
            left: g.pts[i]!.x - 150,
            width: 300,
            textAlign: "center",
            opacity: s[i]!.p,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: g.pts[i]!.y - layout.type.value * 1.5,
              width: 300,
              fontFamily: MONO,
              fontSize: layout.type.value * 0.9,
              color: s[i]!.color,
            }}
          >
            {s[i]!.value}
          </div>
          <Text
            style={{
              position: "absolute",
              top: area.h - g.labelH + 12,
              width: 300,
              fontSize: layout.type.body * 0.9,
              color: colors.text,
            }}
          >
            <Struck st={s[i]!.st} colors={colors}>
              {e.text}
            </Struck>
          </Text>
        </div>
      ))}
    </div>
  );
}

/* ---------- Dos paneles (antes y después, mito y realidad) ---------- */

function halves(layout: Layout, area: Area) {
  const half = layout.vertical
    ? { w: area.w, h: (area.h - 40) / 2 }
    : { w: (area.w - 40) / 2, h: area.h };
  const at = (k: number): Pt =>
    layout.vertical
      ? { x: area.x + area.w / 2, y: area.y + k * (half.h + 40) + half.h / 2 }
      : { x: area.x + k * (half.w + 40) + half.w / 2, y: area.y + area.h / 2 };
  return { half, at };
}

function Panel({
  label,
  value,
  text,
  extra,
  main,
  state,
  colors,
  layout,
  size,
}: {
  label: string;
  value: string;
  text: string | undefined;
  extra?: ReactNode;
  main: boolean;
  state: ElState | undefined;
  colors: BrandColors;
  layout: Layout;
  size: { w: number; h: number };
}) {
  const p = state?.p ?? 0;
  const tone = main ? colors.accent : colors.cream;
  return (
    <div
      style={{
        width: size.w,
        height: size.h,
        borderRadius: 16,
        background: main ? alpha(colors.accent, 0.12) : alpha(colors.cream, 0.06),
        border: `2px solid ${main ? colors.accent : alpha(colors.cream, 0.2)}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        ...rise(p, 30),
      }}
    >
      {state?.icon ? (
        <StateIcon s={{ ...state, color: tone }} size={layout.vertical ? 96 : 120} />
      ) : null}
      <div
        style={{
          fontFamily: MONO,
          fontSize: layout.type.mono,
          letterSpacing: "0.12em",
          color: tone,
        }}
      >
        {label}
      </div>
      {value ? (
        <div
          style={{
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: layout.type.value * 2,
            color: tone,
          }}
        >
          {value}
        </div>
      ) : null}
      <Text
        style={{
          fontSize: value ? layout.type.sub : layout.type.title,
          fontWeight: value ? 400 : 600,
          color: colors.text,
          textAlign: "center",
          maxWidth: size.w * 0.8,
        }}
      >
        <Struck st={state?.st ?? 0} colors={colors}>
          {text}
        </Struck>
      </Text>
      {extra}
    </div>
  );
}

function BeforeAfter({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const { half } = halves(layout, area);
  const [before, after] = elements;
  return (
    <div
      style={{
        position: "absolute",
        left: area.x,
        top: area.y,
        width: area.w,
        height: area.h,
        display: "flex",
        flexDirection: layout.vertical ? "column" : "row",
        gap: 40,
      }}
    >
      <Panel
        label="ANTES"
        value={before?.value ? s[0]!.value : ""}
        text={before?.text}
        main={false}
        state={s[0]}
        colors={colors}
        layout={layout}
        size={half}
      />
      <Panel
        label="DESPUÉS"
        value={after?.value ? s[1]!.value : ""}
        text={after?.text}
        main
        state={s[1]}
        colors={colors}
        layout={layout}
        size={half}
      />
    </div>
  );
}

const halvesAnchors = (n: number, layout: Layout, area: Area): Pt[] => {
  const { at } = halves(layout, area);
  return Array.from({ length: n }, (_, i) => at(Math.min(i, 1)));
};

/** Mito y realidad: el mito a un lado (se tacha) y la realidad al otro. */
function Myth({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const { half } = halves(layout, area);
  const [myth, reality, ...more] = elements;
  return (
    <div
      style={{
        position: "absolute",
        left: area.x,
        top: area.y,
        width: area.w,
        height: area.h,
        display: "flex",
        flexDirection: layout.vertical ? "column" : "row",
        gap: 40,
      }}
    >
      <Panel
        label="MITO"
        value={myth?.value ? s[0]!.value : ""}
        text={myth?.text}
        main={false}
        state={s[0]}
        colors={colors}
        layout={layout}
        size={half}
      />
      <Panel
        label="REALIDAD"
        value={reality?.value ? s[1]!.value : ""}
        text={reality?.text}
        main
        state={s[1]}
        colors={colors}
        layout={layout}
        size={half}
        extra={more.map((e, i) => (
          <Text
            key={i}
            style={{ fontSize: layout.type.body, color: s[i + 2]!.color, ...rise(s[i + 2]!.p) }}
          >
            {[s[i + 2]!.value, e.text].filter(Boolean).join(" · ")}
          </Text>
        ))}
      />
    </div>
  );
}

/* ---------- Comparación ---------- */

function comparisonGeometry(n: number, layout: Layout, area: Area) {
  const rowH = Math.min(area.h / Math.max(n, 1), 180);
  const labelW = layout.vertical ? area.w : area.w * 0.3;
  return { rowH, labelW, top: area.y + (area.h - rowH * n) / 2 };
}

function Comparison({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const g = comparisonGeometry(elements.length, layout, area);
  const scale = barScale(s.map((x) => (x.num === null ? null : Math.max(x.num, 0))));
  // Espacio para la cifra a la derecha de la barra.
  const valueW = 260;
  return (
    <div style={{ position: "absolute", left: area.x, top: g.top, width: area.w }}>
      {elements.map((e, i) => {
        const w =
          ((layout.vertical ? area.w : area.w - g.labelW - 40) - valueW - 20) *
          scale[i]! *
          (s[i]!.num === null ? s[i]!.p : 1);
        return (
          <div
            key={i}
            style={{
              height: g.rowH,
              display: "flex",
              flexDirection: layout.vertical ? "column" : "row",
              alignItems: layout.vertical ? "flex-start" : "center",
              gap: layout.vertical ? 8 : 40,
            }}
          >
            <Text
              style={{
                width: g.labelW,
                flexShrink: 0,
                fontSize: layout.type.sub,
                color: colors.text,
                opacity: s[i]!.p,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <StateIcon s={s[i]} size={layout.type.sub * 1.5} />
              <Struck st={s[i]!.st} colors={colors}>
                {e.text}
              </Struck>
            </Text>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div
                style={{ width: w, height: g.rowH * 0.42, borderRadius: 8, background: s[i]!.fill }}
              />
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: layout.type.value,
                  color: s[i]!.color,
                  opacity: s[i]!.p,
                  whiteSpace: "nowrap",
                }}
              >
                {s[i]!.value}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const comparisonAnchors = (n: number, layout: Layout, area: Area): Pt[] => {
  const g = comparisonGeometry(n, layout, area);
  return Array.from({ length: n }, (_, i) => ({
    x: layout.vertical ? area.x + area.w / 2 : area.x + g.labelW + 40 + 200,
    y: g.top + g.rowH * (i + 0.5),
  }));
};

/* ---------- Red de conexiones ---------- */

function networkPoints(n: number, layout: Layout, area: Area) {
  const cx = area.w / 2;
  const cy = area.h / 2;
  const r = Math.min(area.w, area.h) * 0.38;
  const count = Math.max(n, 1);
  const pts = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r * (layout.vertical ? 0.95 : 1.5), y: cy + Math.sin(a) * r };
  });
  return { cx, cy, pts };
}

function Network({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const frame = useCurrentFrame();
  const first = Math.min(...story.enter, 0);
  const center = interpolate(frame, [first, first + BEAT_FRAMES], [0, 1], {
    easing: brandEase,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const { cx, cy, pts } = networkPoints(elements.length, layout, area);
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }}>
      <svg width={area.w} height={area.h} style={{ position: "absolute" }}>
        {pts.map((pt, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + (pt.x - cx) * s[i]!.p}
            y2={cy + (pt.y - cy) * s[i]!.p}
            stroke={alpha(colors.cream, 0.35)}
            strokeWidth={3}
          />
        ))}
        <circle cx={cx} cy={cy} r={36 * center} fill={colors.accent} />
        {pts.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={18 * s[i]!.p} fill={s[i]!.color} />
        ))}
      </svg>
      {elements.map((e, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: pts[i]!.x - 170,
            top: pts[i]!.y + (s[i]!.icon ? 56 : 28),
            width: 340,
            textAlign: "center",
            opacity: s[i]!.p,
          }}
        >
          {e.value ? (
            <div style={{ fontFamily: MONO, fontSize: layout.type.mono * 1.4, color: s[i]!.color }}>
              {s[i]!.value}
            </div>
          ) : null}
          <Text style={{ fontSize: layout.type.body, color: colors.text }}>
            <Struck st={s[i]!.st} colors={colors}>
              {e.text}
            </Struck>
          </Text>
        </div>
      ))}
      {/* Con ícono, el nodo es el objeto: el ícono sobre un disco del lienzo. */}
      {elements.map((_, i) =>
        s[i]!.icon ? (
          <div
            key={`icon-${i}`}
            style={{
              position: "absolute",
              left: pts[i]!.x - 44,
              top: pts[i]!.y - 44,
              width: 88,
              height: 88,
              borderRadius: 44,
              background: colors.canvas,
              border: `2px solid ${s[i]!.color}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: s[i]!.p,
              transform: `scale(${0.6 + 0.4 * s[i]!.p})`,
            }}
          >
            <StateIcon s={s[i]} size={52} />
          </div>
        ) : null,
      )}
    </div>
  );
}

const networkAnchors = (n: number, layout: Layout, area: Area): Pt[] =>
  networkPoints(n, layout, area).pts.map((p) => ({ x: area.x + p.x, y: area.y + p.y }));

/* ---------- Zoom a un detalle ---------- */

function Zoom({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1.12], { extrapolateRight: "clamp" });
  const [main, ...rest] = elements;
  return (
    <div
      style={{
        position: "absolute",
        left: area.x,
        top: area.y,
        width: area.w,
        height: area.h,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 32,
      }}
    >
      <div
        style={{
          transform: `scale(${zoom})`,
          padding: "40px 64px",
          borderRadius: 24,
          border: `4px solid ${alpha(colors.accent, s[0]?.p ?? 0)}`,
          background: alpha(colors.cream, 0.06),
          textAlign: "center",
          opacity: s[0]?.p,
        }}
      >
        <StateIcon
          s={s[0] && { ...s[0], color: colors.accent }}
          size={layout.vertical ? 120 : 140}
          style={{ margin: "0 auto 16px" }}
        />
        {main?.value ? (
          <div
            style={{
              fontFamily: MONO,
              fontWeight: 600,
              fontSize: layout.type.value * 2,
              color: colors.accent,
            }}
          >
            {s[0]!.value}
          </div>
        ) : null}
        <Text style={{ fontSize: layout.type.title, fontWeight: 600, color: colors.text }}>
          <Struck st={s[0]?.st ?? 0} colors={colors}>
            {main?.text}
          </Struck>
        </Text>
      </div>
      {rest.map((e, i) => (
        <Text
          key={i}
          style={{
            fontSize: layout.type.sub,
            color: s[i + 1]!.color,
            display: "flex",
            alignItems: "center",
            gap: 16,
            ...rise(s[i + 1]!.p),
          }}
        >
          <StateIcon s={s[i + 1]} size={layout.type.sub * 1.3} />
          <Struck st={s[i + 1]!.st} colors={colors}>
            {[s[i + 1]!.value, e.text].filter(Boolean).join(" · ")}
          </Struck>
        </Text>
      ))}
    </div>
  );
}

/* ---------- Flujo de pasos (mecanismo) ---------- */

function flowGeometry(n: number, layout: Layout, area: Area) {
  const count = Math.max(n, 1);
  const gap = layout.vertical ? 56 : 72;
  const along = layout.vertical ? area.h : area.w;
  const size = Math.min((along - gap * (count - 1)) / count, layout.vertical ? 240 : 440);
  const total = size * count + gap * (count - 1);
  const start = (along - total) / 2;
  const node = (i: number) => {
    const at = start + i * (size + gap);
    return layout.vertical
      ? { x: area.x, y: area.y + at, w: area.w, h: size }
      : { x: area.x + at, y: area.y + area.h / 2 - 170, w: size, h: 340 };
  };
  return { node, gap };
}

function Flow({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const g = flowGeometry(elements.length, layout, area);
  return (
    <>
      <svg
        width={layout.width}
        height={layout.height}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
      >
        {elements.slice(1).map((_, k) => {
          const i = k + 1;
          const a = g.node(i - 1);
          const b = g.node(i);
          const from = layout.vertical
            ? { x: a.x + a.w / 2, y: a.y + a.h }
            : { x: a.x + a.w, y: a.y + a.h / 2 };
          const to = layout.vertical ? { x: b.x + b.w / 2, y: b.y } : { x: b.x, y: b.y + b.h / 2 };
          const p = s[i]!.p;
          const end = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
          return (
            <g key={i} opacity={p > 0 ? 1 : 0}>
              <line
                x1={from.x + (layout.vertical ? 0 : 8)}
                y1={from.y + (layout.vertical ? 8 : 0)}
                x2={end.x}
                y2={end.y}
                stroke={alpha(colors.cream, 0.5)}
                strokeWidth={4}
              />
              {p > 0.9 ? (
                <polygon
                  points={
                    layout.vertical
                      ? `${to.x - 12},${to.y - 16} ${to.x + 12},${to.y - 16} ${to.x},${to.y - 2}`
                      : `${to.x - 16},${to.y - 12} ${to.x - 16},${to.y + 12} ${to.x - 2},${to.y}`
                  }
                  fill={alpha(colors.cream, 0.5)}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      {elements.map((e, i) => {
        const box = g.node(i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              borderRadius: 16,
              border: `3px solid ${s[i]!.hl > 0 ? s[i]!.color : alpha(colors.cream, 0.25)}`,
              background: alpha(
                s[i]!.hl > 0 ? colors.accent : colors.cream,
                s[i]!.hl > 0 ? 0.12 : 0.06,
              ),
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 16,
              boxSizing: "border-box",
              ...rise(s[i]!.p, 20),
            }}
          >
            {s[i]!.icon ? (
              <StateIcon s={s[i]} size={layout.vertical ? 64 : 88} />
            ) : (
              <div style={{ fontFamily: MONO, fontSize: layout.type.mono, color: s[i]!.color }}>
                {String(i + 1).padStart(2, "0")}
              </div>
            )}
            {e.value ? (
              <div
                style={{
                  fontFamily: MONO,
                  fontWeight: 600,
                  fontSize: layout.type.value,
                  color: s[i]!.color,
                }}
              >
                {s[i]!.value}
              </div>
            ) : null}
            <Text style={{ fontSize: layout.type.sub, color: colors.text, textAlign: "center" }}>
              <Struck st={s[i]!.st} colors={colors}>
                {e.text}
              </Struck>
            </Text>
          </div>
        );
      })}
    </>
  );
}

const flowAnchors = (n: number, layout: Layout, area: Area): Pt[] => {
  const g = flowGeometry(n, layout, area);
  return Array.from({ length: n }, (_, i) => {
    const b = g.node(i);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  });
};

/* ---------- La cuenta ---------- */

const OPERATORS = ["+", "−", "-", "×", "x", "÷", "/", "="];

/** El operador delante de cada término: el que trae su texto, o + y = antes del resultado. */
export function equationTerms(elements: AidElement[]): { op: string | null; text: string }[] {
  return elements.map((e, i) => {
    const m = /^\s*([+−\-×x÷/=])\s+(.*)$/.exec(e.text);
    if (i === 0) return { op: null, text: m ? m[2]! : e.text };
    if (m && OPERATORS.includes(m[1]!)) {
      const op = m[1] === "-" ? "−" : m[1] === "x" ? "×" : m[1] === "/" ? "÷" : m[1]!;
      return { op, text: m[2]! };
    }
    return { op: i === elements.length - 1 ? "=" : "+", text: e.text };
  });
}

function equationGeometry(n: number, layout: Layout, area: Area) {
  const count = Math.max(n, 1);
  const opW = layout.vertical ? 0 : 72;
  const along = layout.vertical ? area.h : area.w;
  const size = Math.min((along - opW * (count - 1)) / count, layout.vertical ? 220 : 360);
  const total = size * count + opW * (count - 1);
  const start = (along - total) / 2;
  const term = (i: number): Pt =>
    layout.vertical
      ? { x: area.x + area.w / 2, y: area.y + start + i * size + size / 2 }
      : { x: area.x + start + i * (size + opW) + size / 2, y: area.y + area.h / 2 };
  return { size, opW, term };
}

function Equation({ elements, colors, layout, area, story }: PieceProps) {
  const s = useStates(elements, story, colors);
  const terms = equationTerms(elements);
  const g = equationGeometry(elements.length, layout, area);
  return (
    <>
      {terms.map((t, i) => {
        const c = g.term(i);
        const last = i === terms.length - 1 && t.op === "=";
        return (
          <div key={i}>
            {t.op ? (
              <div
                style={{
                  position: "absolute",
                  left: layout.vertical ? c.x - 40 : c.x - g.size / 2 - g.opW,
                  top: layout.vertical ? c.y - g.size / 2 - 30 : c.y - 122,
                  width: layout.vertical ? 80 : g.opW,
                  textAlign: "center",
                  fontFamily: MONO,
                  fontSize: layout.type.value * 1.6,
                  lineHeight: "100px",
                  color: alpha(colors.cream, 0.6),
                  opacity: s[i]!.p,
                }}
              >
                {t.op}
              </div>
            ) : null}
            <div
              style={{
                position: "absolute",
                left: c.x - g.size / 2,
                top: c.y - (layout.vertical ? g.size / 2 - 20 : 110),
                width: g.size,
                textAlign: "center",
                ...rise(s[i]!.p),
              }}
            >
              {s[i]!.icon ? (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: "100%",
                    marginBottom: 24,
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <StateIcon s={s[i]} size={layout.vertical ? 64 : 80} />
                </div>
              ) : null}
              <div
                style={{
                  fontFamily: MONO,
                  fontWeight: 600,
                  fontSize: layout.type.value * (last ? 2 : 1.6),
                  color: last ? colors.accent : s[i]!.color,
                  whiteSpace: "nowrap",
                }}
              >
                <Struck st={s[i]!.st} colors={colors}>
                  {elements[i]!.value ? s[i]!.value : t.text}
                </Struck>
              </div>
              {elements[i]!.value ? (
                <Text style={{ fontSize: layout.type.body, color: colors.text, marginTop: 12 }}>
                  {t.text}
                </Text>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

const equationAnchors = (n: number, layout: Layout, area: Area): Pt[] => {
  const g = equationGeometry(n, layout, area);
  return Array.from({ length: n }, (_, i) => g.term(i));
};

const curveAnchors = (n: number, layout: Layout, area: Area): Pt[] =>
  Array.from({ length: n }, (_, i) => ({
    x: area.x + 150 + (i / Math.max(n - 1, 1)) * (area.w - 300),
    y: area.y + area.h / 2,
  }));

const centerAnchors = (n: number, _layout: Layout, area: Area): Pt[] =>
  Array.from({ length: n }, () => ({ x: area.x + area.w / 2, y: area.y + area.h / 2 }));

/**
 * Cada pieza y dónde quedan sus elementos en pantalla (para que la cámara se
 * acerque a uno o un dato viaje de uno a otro).
 */
export const PIECES: Record<
  AidPiece,
  {
    Render: (props: PieceProps) => ReactElement;
    anchors: (n: number, layout: Layout, area: Area) => Pt[];
  }
> = {
  bars: { Render: Bars, anchors: barsAnchors },
  ring: { Render: Ring, anchors: ringAnchors },
  counter: { Render: Counter, anchors: centerColumnAnchors },
  timeline: { Render: Timeline, anchors: timelineAnchors },
  dot_matrix: { Render: DotMatrix, anchors: dotAnchors },
  curve: { Render: Curve, anchors: curveAnchors },
  before_after: { Render: BeforeAfter, anchors: halvesAnchors },
  comparison: { Render: Comparison, anchors: comparisonAnchors },
  network: { Render: Network, anchors: networkAnchors },
  zoom: { Render: Zoom, anchors: centerAnchors },
  flow: { Render: Flow, anchors: flowAnchors },
  equation: { Render: Equation, anchors: equationAnchors },
  myth: { Render: Myth, anchors: halvesAnchors },
};
