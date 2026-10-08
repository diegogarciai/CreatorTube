import type { ReactElement } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { AidElement, AidPiece, BrandColors } from "@planificador/core";
import { barScale, countedText, numericValue, staggerFrames } from "./spec";
import { alpha, brandEase, MONO, Text, useEnter, type Layout } from "./theme";

/**
 * Las piezas de marca de las M (regla 12.2). Cada una anima los elementos de
 * la ficha dentro del área que le deja el título y el pie: serie principal en
 * Naranja marca, referencia en Crema al 35 %, valores en JetBrains Mono.
 */

export type Area = { x: number; y: number; w: number; h: number };
export type PieceProps = {
  elements: AidElement[];
  colors: BrandColors;
  layout: Layout;
  area: Area;
};

const valueText = (e: AidElement) => [e.value, e.unit].filter(Boolean).join(" ");

/** Progreso de entrada de cada elemento, escalonado. */
function useStagger(count: number) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const starts = staggerFrames(count, Math.round(durationInFrames * 0.6));
  return starts.map((s) =>
    interpolate(frame, [s, s + 24], [0, 1], {
      easing: brandEase,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
}

function Bars({ elements, colors, layout, area }: PieceProps) {
  const p = useStagger(elements.length);
  const scale = barScale(elements.map((e) => numericValue(e.value)));
  const gap = layout.vertical ? 32 : 48;
  const n = Math.max(elements.length, 1);
  const barW = Math.min((area.w - gap * (n - 1)) / n, layout.vertical ? 260 : 280);
  const total = barW * n + gap * (n - 1);
  const labelH = layout.type.body * 2.6;
  const maxH = area.h - labelH - layout.type.value * 1.6;
  return (
    <div
      style={{
        position: "absolute",
        left: area.x + (area.w - total) / 2,
        top: area.y,
        width: total,
        height: area.h,
      }}
    >
      {/* Eje en cero. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: area.h - labelH,
          height: 2,
          background: alpha(colors.cream, 0.2),
        }}
      />
      {elements.map((e, i) => {
        const h = maxH * scale[i]! * p[i]!;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i * (barW + gap),
              width: barW,
              top: 0,
              height: area.h,
            }}
          >
            <div
              style={{
                position: "absolute",
                bottom: labelH,
                width: barW,
                height: h,
                background: i === 0 ? colors.accent : alpha(colors.cream, 0.35),
                borderRadius: "6px 6px 0 0",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: labelH + h + 12,
                width: barW,
                textAlign: "center",
                fontFamily: MONO,
                fontSize: layout.type.value,
                color: i === 0 ? colors.accent : colors.cream,
                opacity: p[i],
              }}
            >
              {e.value ? countedText(valueText(e), p[i]!) : ""}
            </div>
            <Text
              style={{
                position: "absolute",
                top: area.h - labelH + 16,
                width: barW,
                textAlign: "center",
                fontSize: layout.type.body,
                color: colors.text,
                opacity: p[i],
              }}
            >
              {e.text}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function Ring({ elements, colors, layout, area }: PieceProps) {
  const enter = useEnter(6, 40);
  const main = elements[0];
  const pct = Math.min(Math.max(numericValue(main?.value) ?? 100, 0), 100) / 100;
  const size = Math.min(area.w, area.h) * 0.78;
  const r = size / 2 - 24;
  const c = 2 * Math.PI * r;
  return (
    <div
      style={{
        position: "absolute",
        left: area.x + (area.w - size) / 2,
        top: area.y + (area.h - size) / 2,
        width: size,
        height: size,
      }}
    >
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={alpha(colors.cream, 0.2)}
          strokeWidth={28}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colors.accent}
          strokeWidth={28}
          strokeLinecap="round"
          strokeDasharray={`${c * pct * enter} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
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
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: layout.type.value * 2,
            color: colors.accent,
          }}
        >
          {main?.value ? countedText(valueText(main), enter) : ""}
        </div>
        <Text
          style={{
            fontSize: layout.type.sub,
            color: colors.text,
            textAlign: "center",
            maxWidth: size * 0.7,
          }}
        >
          {main?.text}
        </Text>
      </div>
    </div>
  );
}

function Counter({ elements, colors, layout, area }: PieceProps) {
  const enter = useEnter(4, 50);
  const p = useStagger(elements.length);
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
        }}
      >
        {main?.value ? countedText(valueText(main), enter) : main?.text}
      </div>
      {main?.value ? (
        <Text style={{ fontSize: layout.type.title, color: colors.text, fontWeight: 600 }}>
          {main.text}
        </Text>
      ) : null}
      {rest.map((e, i) => (
        <Text key={i} style={{ fontSize: layout.type.sub, color: colors.cream, opacity: p[i + 1] }}>
          {[valueText(e), e.text].filter(Boolean).join(" · ")}
        </Text>
      ))}
    </div>
  );
}

function Timeline({ elements, colors, layout, area }: PieceProps) {
  const line = useEnter(0, 40);
  const p = useStagger(elements.length);
  const n = Math.max(elements.length, 1);
  const vertical = layout.vertical;
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }}>
      {vertical ? (
        <div
          style={{
            position: "absolute",
            left: 40,
            top: 0,
            width: 4,
            height: area.h * line,
            background: alpha(colors.cream, 0.35),
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            top: area.h / 2,
            left: 0,
            height: 4,
            width: area.w * line,
            background: alpha(colors.cream, 0.35),
          }}
        />
      )}
      {elements.map((e, i) => {
        const t = n > 1 ? i / (n - 1) : 0.5;
        const last = i === n - 1;
        const dot = {
          width: 28,
          height: 28,
          borderRadius: 14,
          background: last ? colors.accent : colors.cream,
          opacity: p[i],
        };
        return vertical ? (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 28,
              top: t * (area.h - 120),
              display: "flex",
              gap: 32,
              alignItems: "center",
              opacity: p[i],
            }}
          >
            <div style={dot} />
            <div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: layout.type.mono * 1.6,
                  color: last ? colors.accent : colors.cream,
                }}
              >
                {valueText(e)}
              </div>
              <Text style={{ fontSize: layout.type.body, color: colors.text }}>{e.text}</Text>
            </div>
          </div>
        ) : (
          <div
            key={i}
            style={{
              position: "absolute",
              top: area.h / 2 - 14,
              left: t * (area.w - 280) + 140 - 14,
              opacity: p[i],
            }}
          >
            <div style={dot} />
            <div
              style={{
                position: "absolute",
                bottom: 56,
                left: -140,
                width: 308,
                textAlign: "center",
                fontFamily: MONO,
                fontSize: layout.type.value,
                color: last ? colors.accent : colors.cream,
              }}
            >
              {valueText(e)}
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
              {e.text}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function DotMatrix({ elements, colors, layout, area }: PieceProps) {
  const frame = useCurrentFrame();
  const main = elements[0];
  const lit = Math.round(Math.min(Math.max(numericValue(main?.value) ?? 50, 0), 100));
  const cols = 10;
  const size = Math.min(area.h * 0.8, layout.vertical ? area.w : area.w * 0.45);
  const cell = size / cols;
  const textW = layout.vertical ? area.w : area.w - size - 80;
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
      <svg width={size} height={size}>
        {Array.from({ length: 100 }, (_, i) => {
          const on = i < lit && frame > 8 + i * 0.6;
          return (
            <circle
              key={i}
              cx={(i % cols) * cell + cell / 2}
              cy={Math.floor(i / cols) * cell + cell / 2}
              r={cell * 0.32}
              fill={on ? colors.accent : alpha(colors.cream, 0.15)}
            />
          );
        })}
      </svg>
      <div style={{ width: textW }}>
        <div
          style={{
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: layout.type.value * 2.4,
            color: colors.accent,
          }}
        >
          {main?.value ? valueText(main) : ""}
        </div>
        <Text style={{ fontSize: layout.type.title, color: colors.text, fontWeight: 600 }}>
          {main?.text}
        </Text>
        {elements.slice(1).map((e, i) => (
          <Text key={i} style={{ fontSize: layout.type.sub, color: colors.cream, marginTop: 16 }}>
            {[valueText(e), e.text].filter(Boolean).join(" · ")}
          </Text>
        ))}
      </div>
    </div>
  );
}

function Curve({ elements, colors, layout, area }: PieceProps) {
  const draw = useEnter(6, 60);
  const values = elements.map((e) => numericValue(e.value) ?? 0);
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
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const len =
    pts.reduce(
      (acc, p, i) => (i ? acc + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) : 0),
      0,
    ) || 1;
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }}>
      <svg width={area.w} height={area.h} style={{ overflow: "visible" }}>
        <line
          x1={0}
          x2={area.w}
          y1={layout.type.value * 1.5 + h}
          y2={layout.type.value * 1.5 + h}
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
          strokeDasharray={`${len * draw} ${len}`}
        />
        {pts.map((p, i) =>
          i / Math.max(pts.length - 1, 1) <= draw + 0.001 ? (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={12}
              fill={i === pts.length - 1 ? colors.accent : colors.cream}
            />
          ) : null,
        )}
      </svg>
      {elements.map((e, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 0,
            left: pts[i]!.x - 150,
            width: 300,
            textAlign: "center",
            opacity: i / Math.max(pts.length - 1, 1) <= draw + 0.001 ? 1 : 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: pts[i]!.y - layout.type.value * 1.5,
              width: 300,
              fontFamily: MONO,
              fontSize: layout.type.value * 0.9,
              color: colors.cream,
            }}
          >
            {valueText(e)}
          </div>
          <Text
            style={{
              position: "absolute",
              top: area.h - labelH + 12,
              width: 300,
              fontSize: layout.type.body * 0.9,
              color: colors.text,
            }}
          >
            {e.text}
          </Text>
        </div>
      ))}
    </div>
  );
}

function BeforeAfter({ elements, colors, layout, area }: PieceProps) {
  const wipe = useEnter(20, 36);
  const first = useEnter(0, 24);
  const [before, after] = elements;
  const half = layout.vertical
    ? { w: area.w, h: (area.h - 40) / 2 }
    : { w: (area.w - 40) / 2, h: area.h };
  const panel = (e: AidElement | undefined, main: boolean, p: number) => (
    <div
      style={{
        width: half.w,
        height: half.h,
        borderRadius: 16,
        background: main ? alpha(colors.accent, 0.12) : alpha(colors.cream, 0.06),
        border: `2px solid ${main ? colors.accent : alpha(colors.cream, 0.2)}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        opacity: p,
        transform: `translateY(${(1 - p) * 30}px)`,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: layout.type.mono,
          letterSpacing: "0.12em",
          color: main ? colors.accent : colors.cream,
        }}
      >
        {main ? "DESPUÉS" : "ANTES"}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontWeight: 600,
          fontSize: layout.type.value * 2,
          color: main ? colors.accent : colors.cream,
        }}
      >
        {e ? valueText(e) : ""}
      </div>
      <Text
        style={{
          fontSize: layout.type.sub,
          color: colors.text,
          textAlign: "center",
          maxWidth: half.w * 0.8,
        }}
      >
        {e?.text}
      </Text>
    </div>
  );
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
      {panel(before, false, first)}
      {panel(after, true, wipe)}
    </div>
  );
}

function Comparison({ elements, colors, layout, area }: PieceProps) {
  const p = useStagger(elements.length);
  const scale = barScale(elements.map((e) => numericValue(e.value)));
  const rowH = Math.min(area.h / Math.max(elements.length, 1), 180);
  const labelW = layout.vertical ? area.w : area.w * 0.3;
  // Espacio para la cifra a la derecha de la barra.
  const valueW = 260;
  return (
    <div
      style={{
        position: "absolute",
        left: area.x,
        top: area.y + (area.h - rowH * elements.length) / 2,
        width: area.w,
      }}
    >
      {elements.map((e, i) => {
        const w =
          ((layout.vertical ? area.w : area.w - labelW - 40) - valueW - 20) * scale[i]! * p[i]!;
        // Serie principal (el primer elemento) en Naranja marca; la referencia en Crema.
        const main = i === 0;
        return (
          <div
            key={i}
            style={{
              height: rowH,
              display: "flex",
              flexDirection: layout.vertical ? "column" : "row",
              alignItems: layout.vertical ? "flex-start" : "center",
              gap: layout.vertical ? 8 : 40,
            }}
          >
            <Text
              style={{
                width: labelW,
                flexShrink: 0,
                fontSize: layout.type.sub,
                color: colors.text,
                opacity: p[i],
              }}
            >
              {e.text}
            </Text>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div
                style={{
                  width: w,
                  height: rowH * 0.42,
                  borderRadius: 8,
                  background: main ? colors.accent : alpha(colors.cream, 0.35),
                }}
              />
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: layout.type.value,
                  color: main ? colors.accent : colors.cream,
                  opacity: p[i],
                  whiteSpace: "nowrap",
                }}
              >
                {e.value ? countedText(valueText(e), p[i]!) : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Network({ elements, colors, layout, area }: PieceProps) {
  const p = useStagger(elements.length);
  const center = useEnter(0, 24);
  const cx = area.w / 2;
  const cy = area.h / 2;
  const r = Math.min(area.w, area.h) * 0.38;
  const n = Math.max(elements.length, 1);
  const pts = elements.map((_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r * (layout.vertical ? 0.95 : 1.5), y: cy + Math.sin(a) * r };
  });
  return (
    <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }}>
      <svg width={area.w} height={area.h} style={{ position: "absolute" }}>
        {pts.map((pt, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + (pt.x - cx) * p[i]!}
            y2={cy + (pt.y - cy) * p[i]!}
            stroke={alpha(colors.cream, 0.35)}
            strokeWidth={3}
          />
        ))}
        <circle cx={cx} cy={cy} r={36 * center} fill={colors.accent} />
        {pts.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={18 * p[i]!} fill={colors.cream} />
        ))}
      </svg>
      {elements.map((e, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: pts[i]!.x - 170,
            top: pts[i]!.y + 28,
            width: 340,
            textAlign: "center",
            opacity: p[i],
          }}
        >
          {e.value ? (
            <div
              style={{ fontFamily: MONO, fontSize: layout.type.mono * 1.4, color: colors.accent }}
            >
              {valueText(e)}
            </div>
          ) : null}
          <Text style={{ fontSize: layout.type.body, color: colors.text }}>{e.text}</Text>
        </div>
      ))}
    </div>
  );
}

function Zoom({ elements, colors, layout, area }: PieceProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1.12], { extrapolateRight: "clamp" });
  const focus = useEnter(10, 30);
  const p = useStagger(elements.length);
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
          border: `4px solid ${alpha(colors.accent, focus)}`,
          background: alpha(colors.cream, 0.06),
          textAlign: "center",
        }}
      >
        {main?.value ? (
          <div
            style={{
              fontFamily: MONO,
              fontWeight: 600,
              fontSize: layout.type.value * 2,
              color: colors.accent,
            }}
          >
            {valueText(main)}
          </div>
        ) : null}
        <Text style={{ fontSize: layout.type.title, fontWeight: 600, color: colors.text }}>
          {main?.text}
        </Text>
      </div>
      {rest.map((e, i) => (
        <Text key={i} style={{ fontSize: layout.type.sub, color: colors.cream, opacity: p[i + 1] }}>
          {[valueText(e), e.text].filter(Boolean).join(" · ")}
        </Text>
      ))}
    </div>
  );
}

export const PIECES: Record<AidPiece, (props: PieceProps) => ReactElement> = {
  bars: Bars,
  ring: Ring,
  counter: Counter,
  timeline: Timeline,
  dot_matrix: DotMatrix,
  curve: Curve,
  before_after: BeforeAfter,
  comparison: Comparison,
  network: Network,
  zoom: Zoom,
};
