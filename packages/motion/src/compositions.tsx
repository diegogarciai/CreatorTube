import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { aidHasNumbers } from "@planificador/core";
import { PIECES } from "./pieces";
import { staggerFrames, type AidProps } from "./spec";
import { alpha, BrandBackground, MONO, Text, useEnter, useExit, useLayout } from "./theme";

const GREEN = "#00FF00";

/** Fondo de C y L: verde puro para croma o transparente. */
function OverlayBackground({ background }: { background: AidProps["background"] }) {
  return background === "green" ? <AbsoluteFill style={{ backgroundColor: GREEN }} /> : null;
}

/** M: motion graphic a pantalla completa (ficha 12.5) con su pieza de marca. */
export function MotionAid({ aid, colors }: AidProps) {
  const layout = useLayout();
  const enter = useEnter(0);
  const exit = useExit();
  const Piece = PIECES[aid.piece ?? "counter"];
  const data = aidHasNumbers(aid);
  const titleH = layout.type.title * 1.3 + 24;
  const footerH = aid.footer ? layout.type.mono * 2 : 0;
  const area = {
    x: layout.box.x,
    y: layout.box.y + titleH + 24,
    w: layout.box.w,
    h: layout.box.h - titleH - 24 - footerH - 24,
  };
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <BrandBackground colors={colors} data={data} />
      <Text
        style={{
          position: "absolute",
          left: layout.box.x,
          top: layout.box.y,
          width: layout.box.w,
          fontSize: layout.type.title,
          fontWeight: 600,
          color: colors.text,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 24}px)`,
        }}
      >
        {aid.title}
      </Text>
      <Piece elements={aid.elements} colors={colors} layout={layout} area={area} />
      {aid.footer ? (
        <div
          style={{
            position: "absolute",
            left: layout.box.x,
            top: layout.box.y + layout.box.h - layout.type.mono * 1.4,
            fontFamily: MONO,
            fontSize: layout.type.mono,
            color: alpha(colors.cream, 0.7),
            opacity: enter,
          }}
        >
          {aid.footer}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

/** C: etiqueta de concepto abajo a la izquierda, sobre los subtítulos (12.8). */
export function ConceptLabel({ aid, colors, background }: AidProps) {
  const enter = useEnter(0);
  const exit = useExit();
  const p = enter * exit;
  return (
    <AbsoluteFill>
      <OverlayBackground background={background} />
      <div
        style={{
          position: "absolute",
          left: 96,
          bottom: 220,
          maxWidth: 980,
          padding: "28px 36px",
          borderRadius: 12,
          // En verde, la caja va opaca: un velo semitransparente se tiñe y ensucia el croma.
          background: alpha(colors.page, background === "green" ? 1 : 0.8),
          borderLeft: `6px solid ${colors.accent}`,
          opacity: p,
          transform: `translateX(${(1 - enter) * -40}px)`,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 22,
            letterSpacing: "0.14em",
            color: colors.accent,
          }}
        >
          CONCEPTO
        </div>
        <Text style={{ fontSize: 48, fontWeight: 600, color: colors.text, marginTop: 8 }}>
          {aid.title}
        </Text>
        {aid.definition ? (
          <Text style={{ fontSize: 32, color: colors.cream, marginTop: 10, lineHeight: 1.25 }}>
            {aid.definition}
          </Text>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

/** L: lista a la derecha; cada elemento entra en su turno (12.8). */
export function ListAid({ aid, colors, background }: AidProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enter = useEnter(0);
  const exit = useExit();
  const starts = staggerFrames(aid.elements.length, durationInFrames);
  return (
    <AbsoluteFill>
      <OverlayBackground background={background} />
      <div
        style={{
          position: "absolute",
          right: 96,
          top: 180,
          width: 760,
          padding: "32px 40px",
          borderRadius: 12,
          // En verde, la caja va opaca: un velo semitransparente se tiñe y ensucia el croma.
          background: alpha(colors.page, background === "green" ? 1 : 0.8),
          opacity: enter * exit,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 24,
            letterSpacing: "0.14em",
            color: colors.accent,
            textTransform: "uppercase",
          }}
        >
          {aid.title}
        </div>
        {aid.elements.map((e, i) => {
          const p = interpolate(frame, [starts[i]!, starts[i]! + 15], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                marginTop: 24,
                opacity: p,
                transform: `translateX(${(1 - p) * 24}px)`,
              }}
            >
              <div style={{ width: 14, height: 14, background: colors.accent, flexShrink: 0 }} />
              <Text style={{ fontSize: 40, color: colors.text }}>{e.text}</Text>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
