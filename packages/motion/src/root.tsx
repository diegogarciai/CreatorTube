import { Composition, registerRoot, type CalculateMetadataFunction } from "remotion";
import { DEFAULT_BRAND_KIT, type VisualAid } from "@planificador/core";
import { ConceptLabel, ListAid, MotionAid } from "./compositions";
import { aidDurationFrames, COMPOSITIONS, FPS, type AidProps } from "./spec";
import { loadBrandFonts } from "./theme";

loadBrandFonts();

/** Ayudas de ejemplo para el estudio de Remotion; en el render llegan las reales. */
const sampleM: VisualAid = {
  kind: "M",
  code: "M1",
  anchor: "En las pruebas",
  idea: "Barras de batería que crecen frase a frase",
  title: "Horas de batería en uso real",
  elements: [
    { text: "MacBook Air M4", value: "18", unit: "h" },
    { text: "MacBook Air M3", value: "15", unit: "h" },
    { text: "Portátil promedio", value: "9", unit: "h" },
  ],
  rows: [1],
  footer: "gartechs.com · Fuente: prueba propia, octubre de 2026",
  durationS: 9,
  piece: "bars",
  vertical: true,
  segment:
    "En las pruebas, el MacBook Air M4 duró 18 horas. El M3 se quedó en 15, y un portátil promedio apenas llega a 9. Son el doble de horas que la media.",
  aidCase: "comparison",
  beats: [
    {
      phrase: "En las pruebas, el MacBook Air M4 duró 18 horas.",
      action: "enter",
      text: "MacBook Air M4",
      value: "18",
      unit: "h",
      row: 1,
    },
    {
      phrase: "El M3 se quedó en 15,",
      action: "enter",
      text: "MacBook Air M3",
      value: "15",
      unit: "h",
      row: 1,
    },
    {
      phrase: "y un portátil promedio apenas llega a 9.",
      action: "enter",
      text: "Portátil promedio",
      value: "9",
      unit: "h",
      row: 1,
    },
    { phrase: "Son el doble de horas que la media.", action: "highlight", target: 0 },
  ],
};
const sampleC: VisualAid = {
  kind: "C",
  code: "C1",
  anchor: "La memoria unificada",
  title: "Memoria unificada",
  definition: "RAM que comparten el procesador y la gráfica",
  elements: [],
  rows: [],
};
const sampleL: VisualAid = {
  kind: "L",
  code: "L1",
  anchor: "Tres cosas importan",
  title: "Lo que importa",
  elements: [
    { text: "La pantalla brillante" },
    { text: "El teclado cómodo" },
    { text: "El peso ligero" },
  ],
  rows: [],
};

const metadata: CalculateMetadataFunction<AidProps> = ({ props }) => ({
  durationInFrames: aidDurationFrames(props.aid),
});

function Root() {
  const colors = DEFAULT_BRAND_KIT.colors;
  return (
    <>
      <Composition
        id={COMPOSITIONS.motion}
        component={MotionAid}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={180}
        defaultProps={{ aid: sampleM, colors, background: "brand" }}
        calculateMetadata={metadata}
      />
      <Composition
        id={COMPOSITIONS.motionVertical}
        component={MotionAid}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={180}
        defaultProps={{ aid: sampleM, colors, background: "brand" }}
        calculateMetadata={metadata}
      />
      <Composition
        id={COMPOSITIONS.concept}
        component={ConceptLabel}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={150}
        defaultProps={{ aid: sampleC, colors, background: "green" }}
        calculateMetadata={metadata}
      />
      <Composition
        id={COMPOSITIONS.list}
        component={ListAid}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={210}
        defaultProps={{ aid: sampleL, colors, background: "green" }}
        calculateMetadata={metadata}
      />
    </>
  );
}

registerRoot(Root);
