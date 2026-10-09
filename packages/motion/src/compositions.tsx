import {
  AbsoluteFill,
  Html5Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { aidHasNumbers } from "@planificador/core";
import { PIECES, type Area, type Pt } from "./pieces";
import { BEAT_FRAMES, sfxCues, staggerFrames, storyFor, type AidProps, type Story } from "./spec";
import {
  alpha,
  BrandBackground,
  brandEase,
  MONO,
  Text,
  useEnter,
  useExit,
  useLayout,
  type Layout,
} from "./theme";

const GREEN = "#00FF00";

/** Fondo de C y L: verde puro para croma o transparente. */
function OverlayBackground({ background }: { background: AidProps["background"] }) {
  return background === "green" ? <AbsoluteFill style={{ backgroundColor: GREEN }} /> : null;
}

/** Los efectos de sonido de la ayuda, cada uno en su cuadro (van en el MP4; el WebM sale mudo). */
function SoundTrack({ aid }: { aid: AidProps["aid"] }) {
  const { durationInFrames } = useVideoConfig();
  return (
    <>
      {sfxCues(aid, durationInFrames).map((c, i) => (
        <Sequence key={i} from={c.frame} layout="none" name={`sfx ${c.sound}`}>
          <Html5Audio src={staticFile(`sfx/${c.sound}.wav`)} volume={c.volume} />
        </Sequence>
      ))}
    </>
  );
}

/** Cuánto se acerca la cámara a un elemento (zoom). */
const CAMERA_ZOOM = 0.35;

/**
 * La cámara: se acerca al elemento de un momento «zoom» mientras se dice su
 * frase y vuelve al plano general en el momento siguiente, con la curva de la
 * marca (sin rebotes).
 */
function useCamera(story: Story, anchors: Pt[], layout: Layout) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  let scale = 1;
  let origin: Pt = { x: layout.width / 2, y: layout.height / 2 };
  let shift: Pt = { x: 0, y: 0 };
  for (const z of story.zooms) {
    const pt = anchors[z.element];
    if (!pt || frame < z.at) continue;
    const next = story.beats.find((b) => b.at > z.at)?.at ?? durationInFrames;
    const opts = {
      easing: brandEase,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    } as const;
    const k = Math.min(
      interpolate(frame, [z.at, z.at + BEAT_FRAMES], [0, 1], opts),
      interpolate(frame, [next, next + BEAT_FRAMES], [1, 0], opts),
    );
    if (k <= 0) continue;
    scale = 1 + CAMERA_ZOOM * k;
    origin = pt;
    // Además de acercarse, lleva el elemento hacia el centro.
    shift = { x: (layout.width / 2 - pt.x) * 0.5 * k, y: (layout.height / 2 - pt.y) * 0.5 * k };
  }
  return { scale, origin, shift };
}

/** Un dato que viaja de un elemento a otro (travel): un punto con su estela. */
function Travels({
  story,
  anchors,
  colors,
}: {
  story: Story;
  anchors: Pt[];
  colors: AidProps["colors"];
}) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
      {story.travels.map((t, i) => {
        const a = anchors[t.from];
        const b = anchors[t.to];
        if (!a || !b) return null;
        const p = interpolate(frame, [t.at, t.at + BEAT_FRAMES], [0, 1], {
          easing: brandEase,
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const fade = interpolate(frame, [t.at + BEAT_FRAMES, t.at + BEAT_FRAMES * 2], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        if (frame < t.at || fade <= 0) return null;
        const x = a.x + (b.x - a.x) * p;
        const y = a.y + (b.y - a.y) * p;
        return (
          <g key={i} opacity={fade}>
            <line
              x1={a.x}
              y1={a.y}
              x2={x}
              y2={y}
              stroke={alpha(colors.accent, 0.5)}
              strokeWidth={4}
              strokeDasharray="10 10"
            />
            <circle cx={x} cy={y} r={16} fill={colors.accent} />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * M: motion graphic a pantalla completa (fichas 12.5). La pieza de marca arma
 * los elementos frase por frase sobre el mismo lienzo; la cámara se acerca a
 * lo que se está explicando y los datos viajan entre elementos. El título y el
 * pie (con gartechs.com) quedan fijos durante toda la animación.
 */
export function MotionAid({ aid, colors }: AidProps) {
  const layout = useLayout();
  const { durationInFrames } = useVideoConfig();
  const enter = useEnter(0);
  const exit = useExit();
  const piece = PIECES[aid.piece ?? "counter"];
  const data = aidHasNumbers(aid);
  const titleH = layout.type.title * 1.3 + 24;
  const footerH = aid.footer ? layout.type.mono * 2 : 0;
  const area: Area = {
    x: layout.box.x,
    y: layout.box.y + titleH + 24,
    w: layout.box.w,
    h: layout.box.h - titleH - 24 - footerH - 24,
  };
  const story = storyFor(aid, durationInFrames);
  const anchors = piece.anchors(aid.elements.length, layout, area);
  const camera = useCamera(story, anchors, layout);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <SoundTrack aid={aid} />
      <BrandBackground colors={colors} data={data} />
      <AbsoluteFill
        style={{
          transformOrigin: `${camera.origin.x}px ${camera.origin.y}px`,
          transform: `translate(${camera.shift.x}px, ${camera.shift.y}px) scale(${camera.scale})`,
        }}
      >
        <piece.Render
          elements={aid.elements}
          colors={colors}
          layout={layout}
          area={area}
          story={story}
        />
        <Travels story={story} anchors={anchors} colors={colors} />
      </AbsoluteFill>
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
      <SoundTrack aid={aid} />
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
      <SoundTrack aid={aid} />
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
