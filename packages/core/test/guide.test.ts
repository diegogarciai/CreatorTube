import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_SECTIONS,
  parseGuide,
  sectionsText,
  stagesBySection,
  validateGuide,
} from "../src/guide";

const SAMPLE = `PAQUETE DE REGLAS GARTECHS · v4.1 · 6 de octubre de 2026
Fuente única: el panel de planificación.

0. PRIORIDADES
Cuando dos reglas no se pueden cumplir a la vez, gana la que esté más arriba:
1. Verdad. Ningún dato falso.
2. Riesgo legal y de plataforma.

## 1. ROL
Tienes dos trabajos.

**2. CANAL, PRESENTADOR Y AUDIENCIA**
Canal: Gartechs.

4. DOSSIER DE ESTUDIO
4.1 Lo esencial en 5 líneas.
4.2 Cómo funciona por dentro.

9. LLAMADAS A LA ACCIÓN E INVITACIONES
9.6 Secuencia de cierre
1. Pregunta de cierre.
2. CTA B.
3. Próximo video.

MÓDULO POSTPUBLICACIÓN (secciones 20 y 21)

20. RESPUESTA A COMENTARIOS
Es Diego respondiendo.
`;

describe("guía del guionista por secciones", () => {
  it("corta por títulos numerados en mayúsculas y conserva el resto", () => {
    const g = parseGuide(SAMPLE);
    expect(g.preamble).toContain("PAQUETE DE REGLAS");
    expect(g.sections.map((s) => [s.key, s.title])).toEqual([
      ["0", "PRIORIDADES"],
      ["1", "ROL"],
      ["2", "CANAL, PRESENTADOR Y AUDIENCIA"],
      ["4", "DOSSIER DE ESTUDIO"],
      ["9", "LLAMADAS A LA ACCIÓN E INVITACIONES"],
      ["20", "RESPUESTA A COMENTARIOS"],
    ]);
    // Listas numeradas y subsecciones quedan dentro de su sección.
    expect(g.sections[0]!.body).toContain("1. Verdad.");
    expect(g.sections[3]!.body).toContain("4.2 Cómo funciona");
    expect(g.sections[4]!.body).toContain("2. CTA B.");
  });

  it("valida que estén todas las secciones que piden las etapas", () => {
    const g = parseGuide(SAMPLE);
    const v = validateGuide(g, DEFAULT_STAGE_SECTIONS);
    expect(v.ok).toBe(false);
    expect(v.missing).toContain("3");
    expect(v.missing).not.toContain("0");
    expect(validateGuide(g, { ...emptyStages(), study: ["0", "1"] })).toEqual({
      ok: true,
      missing: [],
    });
    expect(validateGuide(parseGuide("sin secciones"), emptyStages()).ok).toBe(false);
  });

  it("arma el texto de una etapa en el orden de la guía", () => {
    const g = parseGuide(SAMPLE);
    const text = sectionsText(g.sections, ["2", "0"]);
    expect(text.startsWith("0. PRIORIDADES\n")).toBe(true);
    expect(text).toContain("\n\n2. CANAL, PRESENTADOR Y AUDIENCIA\nCanal: Gartechs.");
    expect(text).not.toContain("ROL");
  });

  it("dice qué etapas reciben cada sección", () => {
    const by = stagesBySection(DEFAULT_STAGE_SECTIONS);
    expect(by["2"]).toContain("direction");
    expect(by["10"]).toEqual([
      "script",
      "verification_extract",
      "verification_fix",
      "verification_mark",
    ]);
    expect(by["22"]).toEqual(["podcast"]);
  });
});

function emptyStages() {
  return Object.fromEntries(
    Object.keys(DEFAULT_STAGE_SECTIONS).map((k) => [k, [] as string[]]),
  ) as unknown as typeof DEFAULT_STAGE_SECTIONS;
}
