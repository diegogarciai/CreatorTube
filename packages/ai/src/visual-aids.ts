import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  AID_FOOTER_SITE,
  AID_PIECES,
  checkPlan,
  MAX_MOTION,
  MIN_MOTION_SCORE,
  type PlanCheck,
  type VisualAid,
} from "@planificador/core";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { AiRefusalError, type AiConfig } from "./generate";
import type { StreamClient } from "./stages";
import { verificationTable, type Claim } from "./verification";

/**
 * Plan de ayudas visuales (Fase 3 · paso 3, sección 12 de las reglas): Claude
 * propone las M (fichas 12.5), las C y las L (12.8) del guion verificado, y el
 * código se queda solo con lo que cumple las reglas (`checkPlan`).
 */

const score = z.number().int().min(1).max(5);

const planSchema = z.object({
  aids: z.array(
    z.object({
      kind: z.enum(["M", "C", "L"]).describe("M motion graphic, C etiqueta de concepto, L lista."),
      anchor: z
        .string()
        .describe(
          "Las primeras palabras exactas del párrafo del guion donde entra, copiadas tal cual.",
        ),
      idea: z.string().describe("M: la idea visual en una frase. C y L: vacío."),
      title: z
        .string()
        .describe(
          "M: título en pantalla (máx. 6 palabras). C: el término. L: el título (máx. 4 palabras).",
        ),
      definition: z.string().describe("C: la definición (máx. 14 palabras). M y L: vacío."),
      elements: z
        .array(
          z.object({
            text: z.string().describe("De 2 a 6 palabras."),
            value: z.string().describe("M: la cifra exacta de su fila, si la hay. Si no, vacío."),
            unit: z.string().describe("M: la unidad de la cifra, si la hay. Si no, vacío."),
            anchor: z
              .string()
              .describe(
                "L: las primeras palabras exactas donde empieza ese elemento. Si no, vacío.",
              ),
          }),
        )
        .describe("M: los elementos exactos que se animan. L: los elementos. C: ninguno."),
      rows: z
        .array(z.number().int())
        .describe(
          "M: los # de las filas de verificación de donde sale cada cifra. Si no hay cifras, vacío.",
        ),
      footer: z
        .string()
        .describe(
          `M: el pie: ${AID_FOOTER_SITE} siempre, y fuente y fecha si hay cifras. C y L: vacío.`,
        ),
      duration_s: z.number().int().describe("M: duración en segundos. C y L: 0."),
      piece: z
        .enum(AID_PIECES)
        .describe("M: la pieza de marca que la anima. C y L: cualquiera, se ignora."),
      scores: z
        .object({
          simplifies: score.describe("Simplifica algo difícil de explicar con palabras."),
          central: score.describe("Es central para la tesis del video."),
          reusable: score.describe("Sirve para un reel o la miniatura."),
          no_real_image: score.describe("Ninguna imagen real lo hace mejor."),
        })
        .describe("M: los cuatro criterios de 12.1. C y L: todos en 1."),
      vertical: z.boolean().describe("M: true solo en la más fuerte, que va también en vertical."),
    }),
  ),
});

export interface VisualPlanInput {
  episodeTitle: string;
  /** El teleprompter verificado (paso «fix»). */
  script: string;
  claims: Claim[];
  /** Las fichas 12.5 que escribió el paso «motion», si las hay. */
  motionFichas: string;
  /** La sección 12 de la guía del guionista. */
  guide: string;
}

/**
 * El plan de ayudas visuales del episodio. Devuelve lo que cumple las reglas
 * de la sección 12 (en orden de guion, con sus códigos) y lo que se descartó.
 */
export async function visualAidPlan(
  client: StreamClient,
  config: AiConfig,
  input: VisualPlanInput,
): Promise<PlanCheck & { usage: UsageTotals; model: string }> {
  const system = [
    "Armas el plan de ayudas visuales de un video de YouTube de un canal de tecnología, con la sección 12 de la guía del guionista (abajo). Respondes en español.",
    "Tres tipos: M, motion graphic a pantalla completa (fichas 12.5); C, etiqueta de concepto, y L, lista (12.8). Las C y L no tapan la pantalla.",
    `M: solo cuando cumple uno de los seis casos de 12.1 y suma ${MIN_MOTION_SCORE} de 20 o más en sus cuatro criterios (puntúa con honestidad). Una cada 2–3 minutos, máximo ${MAX_MOTION}, nunca dos en el mismo párrafo ni en párrafos seguidos. Cero también vale.`,
    "M: cada una con una pieza de marca distinta (no se repite en el episodio) y un concepto visual distinto (12.2). Toda cifra en pantalla sale de una fila Verificado o Con matiz de la tabla de verificación, con su # en «rows» (12.3). El pie lleva gartechs.com, y la fuente y la fecha si hay cifras.",
    "Textos en pantalla (12.4): título de M de 1 a 6 palabras; elementos de 2 a 6 palabras; definición de C de 14 palabras o menos; título de L de 4 palabras o menos.",
    "C: un término técnico, sigla o idea, una vez por término y en su primera aparición; unas 6 cada 10 minutos. L: cuando se enumeran 3 cosas o más, cada elemento con dónde empieza.",
    "Un párrafo con M no lleva C ni L.",
    "El ancla («anchor») son las primeras palabras exactas del párrafo, copiadas del guion verificado: si no aparecen tal cual, la ayuda se descarta.",
    "Si ya hay fichas 12.5 del paso de motion graphics, respétalas y complétalas; descarta las que no cumplen.",
  ].join("\n");
  const user = [
    `Tema del episodio: ${input.episodeTitle}`,
    "",
    "## Sección 12 de la guía",
    input.guide.trim() || "(sin guía)",
    "",
    "## Guion verificado (teleprompter)",
    input.script.trim(),
    "",
    "## Tabla de verificación",
    verificationTable(input.claims),
    ...(input.motionFichas.trim()
      ? ["", "## Fichas 12.5 del paso de motion graphics", input.motionFichas.trim()]
      : []),
  ].join("\n");

  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 12_000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "medium", format: betaZodOutputFormat(planSchema) },
    ...(config.fallbacks && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
  });
  if (res.stop_reason === "refusal") {
    const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new AiRefusalError(details?.category ?? null);
  }
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("El plan de ayudas visuales llegó incompleto");

  const blank = (s: string) => s.trim() || null;
  const aids: VisualAid[] = parsed.aids.map((a, i) => ({
    kind: a.kind,
    code: `${a.kind}${i + 1}`,
    anchor: a.anchor.trim(),
    idea: a.kind === "M" ? blank(a.idea) : null,
    title: a.title.trim(),
    definition: a.kind === "C" ? blank(a.definition) : null,
    elements:
      a.kind === "C"
        ? []
        : a.elements.map((e) => ({
            text: e.text.trim(),
            value: a.kind === "M" ? blank(e.value) : null,
            unit: a.kind === "M" ? blank(e.unit) : null,
            anchor: a.kind === "L" ? blank(e.anchor) : null,
          })),
    rows: a.kind === "M" ? [...new Set(a.rows)] : [],
    footer: a.kind === "M" ? blank(a.footer) : null,
    durationS: a.kind === "M" ? a.duration_s : null,
    piece: a.kind === "M" ? a.piece : null,
    scores:
      a.kind === "M"
        ? {
            simplifies: a.scores.simplifies,
            central: a.scores.central,
            reusable: a.scores.reusable,
            noRealImage: a.scores.no_real_image,
          }
        : null,
    vertical: a.kind === "M" && a.vertical,
  }));
  const checked = checkPlan(aids, {
    script: input.script,
    claims: input.claims.map((c) => ({ idx: c.idx, status: c.status })),
  });
  return { ...checked, usage: addUsage(emptyUsage(), res.usage), model: res.model };
}
