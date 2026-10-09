import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  AID_CASES,
  AID_ICON_GROUPS,
  AID_ICONS,
  isAidIcon,
  AID_FOOTER_SITE,
  AID_PIECES,
  BEAT_ACTIONS,
  checkPlan,
  DEFAULT_SPEECH_WPM,
  elementsFromBeats,
  MAX_MOTION,
  MIN_MOTION_SCORE,
  MOTION_MAX_SECONDS,
  MOTION_MIN_SECONDS,
  paragraphOf,
  PIECE_ACTIONS,
  pieceLabel,
  rowsFromBeats,
  scriptParagraphs,
  motionSeconds,
  validateAidText,
  type AidBeat,
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
            anchor: z
              .string()
              .describe("Las primeras palabras exactas donde empieza ese elemento."),
          }),
        )
        .describe("L: los elementos. M y C: ninguno (los de la M salen de sus momentos)."),
      segment: z
        .string()
        .describe(
          "M: el texto exacto del guion que la M explica, copiado tal cual: empieza en el párrafo del ancla y puede seguir al siguiente si explican lo mismo. Su duración es la de ese texto dicho. C y L: vacío.",
        ),
      case: z.enum(AID_CASES).describe("M: el caso de 12.1. C y L: cualquiera, se ignora."),
      beats: z
        .array(
          z.object({
            phrase: z
              .string()
              .describe(
                "Las palabras exactas de una frase del segmento, en orden. Juntas, las frases cubren todo el segmento.",
              ),
            action: z
              .enum(BEAT_ACTIONS)
              .describe(
                "Qué pasa en pantalla mientras se dice la frase: enter (entra el elemento que crea, con su animación: la barra crece, la cifra cuenta, el nodo se conecta), highlight (un elemento se pinta en naranja: lo que importa o la conclusión), zoom (la cámara se acerca a un elemento), travel (un dato viaja hasta un elemento), strike (se tacha un elemento: el mito), change (un elemento cambia de estado: toma una cifra nueva, un ícono nuevo o ambos).",
              ),
            target: z
              .number()
              .int()
              .describe(
                "Si no crea un elemento: el elemento sobre el que actúa (0 es el primero que entró). Si lo crea: -1.",
              ),
            text: z
              .string()
              .describe(
                "Si crea un elemento: su texto en pantalla, de 2 a 6 palabras, que resume y nunca lee la frase. Si no: vacío.",
              ),
            value: z
              .string()
              .describe(
                "La cifra exacta de su fila (al crear con cifra o en un change). Si no hay, vacío.",
              ),
            unit: z.string().describe("La unidad de la cifra. Si no hay, vacío."),
            row: z
              .number()
              .int()
              .describe("El # de la fila de verificación de la cifra. Sin cifra: 0."),
            icon: z
              .enum(["ninguno", ...AID_ICONS] as [string, ...string[]])
              .describe(
                "El ícono de la biblioteca que representa el elemento que crea (el objeto: chip, bateria, nube, usuario…), o el nuevo ícono en un change (bateria_baja → bateria_llena). Si ninguno ayuda: ninguno.",
              ),
          }),
        )
        .describe(
          "M: el guion de animación, de 2 a 8 momentos, uno por frase: algo se mueve en cada frase (12.6). El primero hace entrar un elemento. C y L: ninguno.",
        ),
      footer: z
        .string()
        .describe(
          `M: el pie: ${AID_FOOTER_SITE} siempre, y fuente y fecha si hay cifras. C y L: vacío.`,
        ),
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
  /** Ritmo de lectura del canal (palabras por minuto): de ahí sale la duración de cada M. */
  speechWpm?: number;
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
): Promise<PlanCheck & { repaired: number; usage: UsageTotals; model: string }> {
  const system = [
    "Armas el plan de ayudas visuales de un video de YouTube de un canal de tecnología, con la sección 12 de la guía del guionista (abajo). Respondes en español.",
    "Tres tipos: M, motion graphic a pantalla completa (fichas 12.5); C, etiqueta de concepto, y L, lista (12.8). Las C y L no tapan la pantalla.",
    `M: solo cuando cumple uno de los seis casos de 12.1 y suma ${MIN_MOTION_SCORE} de 20 o más en sus cuatro criterios (puntúa con honestidad). Una cada 2–3 minutos, máximo ${MAX_MOTION}, nunca dos en el mismo párrafo ni en párrafos seguidos. Cero también vale.`,
    "M: cada una con una pieza de marca distinta (no se repite en el episodio) y un concepto visual distinto (12.2). Toda cifra en pantalla sale de una fila Verificado o Con matiz de la tabla de verificación, con su # en «row» del momento que la muestra (12.3). El pie lleva gartechs.com, y la fuente y la fecha si hay cifras.",
    "Textos en pantalla (12.4): título de M de 1 a 6 palabras; elementos de 2 a 6 palabras; definición de C de 14 palabras o menos; título de L de 4 palabras o menos. Cuenta las palabras antes de responder.",
    `M: no es una pieza suelta con un título: es un guion de animación. Extrae del guion el segmento que la M explica (copiado tal cual), pártelo en sus frases y di, para cada frase, qué se mueve en pantalla. Dura lo que tarda en decirse el segmento (de ${MOTION_MIN_SECONDS} a ${MOTION_MAX_SECONDS} segundos): elige el tramo justo, ni medio párrafo de relleno ni una frase suelta.`,
    `M: cada elemento lleva el ícono de la biblioteca que mejor lo representa, para que la animación muestre objetos y no solo texto: ${Object.entries(
      AID_ICON_GROUPS,
    )
      .map(([g, icons]) => `${g}: ${icons.join(", ")}`)
      .join(
        "; ",
      )}. Un cambio de estado puede cambiar el ícono (candado → candado_abierto, bateria_baja → bateria_llena).`,
    "M: los elementos se construyen sobre un mismo lienzo, frase a frase: lo que entra se queda, cambia de estado, se compara, se conecta o se resalta; la última frase suele cerrar con la conclusión resaltada. El texto en pantalla resume, nunca lee el párrafo (12.4).",
    `M: qué sabe hacer cada pieza: ${Object.entries(PIECE_ACTIONS)
      .map(([p, a]) => `${p} (${pieceLabel(p as keyof typeof PIECE_ACTIONS)}): ${a.join(", ")}`)
      .join("; ")}.`,
    "C: un término técnico, sigla o idea, una vez por término y en su primera aparición; unas 6 cada 10 minutos. L: cuando se enumeran 3 cosas o más, cada elemento con dónde empieza.",
    "Un párrafo con M no lleva C ni L.",
    "El ancla («anchor») son las primeras palabras exactas del párrafo, copiadas del guion verificado: si no aparecen tal cual, la ayuda se descarta.",
    "Si ya hay fichas 12.5 del paso de motion graphics, respétalas y complétalas (su idea visual y su contenido pasan al guion de animación); descarta las que no cumplen.",
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

  const call = async (sys: string, content: string) => {
    const res = await client.beta.messages.parse({
      model: config.model,
      max_tokens: 16_000,
      system: sys,
      messages: [{ role: "user", content }],
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
    return res;
  };

  const wpm = input.speechWpm ?? DEFAULT_SPEECH_WPM;
  const res = await call(system, user);
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("El plan de ayudas visuales llegó incompleto");
  let usage = addUsage(emptyUsage(), res.usage);
  const raw = [...parsed.aids];
  let aids: VisualAid[] = raw.map((a, i) => toAid(a, `${a.kind}${i + 1}`, wpm));

  // Una vuelta de corrección: los textos fuera de límite (12.4) y las anclas
  // que no aparecen tal cual. Si falla, quedan las originales (y checkPlan
  // marca los textos para corregir a mano).
  const paragraphs = scriptParagraphs(input.script);
  const problems = aids
    .map((a, i) => {
      const reasons = validateAidText(a);
      if (a.kind === "M" && a.segment && !foldText(input.script).includes(foldText(a.segment)))
        reasons.push(
          "El segmento no aparece tal cual en el guion: cópialo exacto, sin cambiar palabras.",
        );
      if (paragraphOf(paragraphs, a.anchor) < 0)
        reasons.push(
          "El ancla no aparece tal cual en el guion: copia las primeras palabras exactas del párrafo.",
        );
      return { i, reasons };
    })
    .filter((p) => p.reasons.length);
  let repaired = 0;
  if (problems.length) {
    try {
      const fix = await call(
        [
          "Corriges ayudas visuales que no cumplen el formato de la sección 12 de la guía. Respondes en español.",
          "Devuelves exactamente las mismas ayudas, en el mismo orden y del mismo tipo, con el mismo contenido y la misma intención: solo cambias lo necesario para cumplir los motivos indicados.",
          "Textos en pantalla (12.4): título de M de 1 a 6 palabras; elementos de 2 a 6 palabras; definición de C de 14 palabras o menos; título de L de 4 palabras o menos. Cuenta las palabras antes de responder.",
          "El ancla son las primeras palabras exactas del párrafo y el segmento, el texto exacto del guion; las frases de los momentos copian el segmento en orden y lo cubren entero, y cada acción es una que su pieza sabe hacer.",
        ].join("\n"),
        [
          "## Ayudas que corregir (con sus motivos)",
          JSON.stringify(
            problems.map((p) => ({ ayuda: raw[p.i], motivos: p.reasons })),
            null,
            2,
          ),
          "",
          "## Guion verificado (para copiar las anclas)",
          input.script.trim(),
        ].join("\n"),
      );
      usage = addUsage(usage, fix.usage);
      const fixed = fix.parsed_output?.aids ?? [];
      if (fixed.length === problems.length) {
        aids = aids.map((a, i) => {
          const k = problems.findIndex((p) => p.i === i);
          const f = k >= 0 ? fixed[k] : undefined;
          if (!f || f.kind !== a.kind) return a;
          const next = toAid(f, a.code, wpm);
          if (!validateAidText(next).length) repaired++;
          return next;
        });
      }
    } catch (err) {
      if (err instanceof AiRefusalError) throw err;
      // Sin corrección: siguen las originales.
    }
  }

  const checked = checkPlan(aids, {
    script: input.script,
    claims: input.claims.map((c) => ({ idx: c.idx, status: c.status })),
  });
  return { ...checked, repaired, usage, model: res.model };
}

type RawAid = z.infer<typeof planSchema>["aids"][number];

/** Sin acentos, signos ni mayúsculas, para comparar textos copiados del guion. */
const foldText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function toBeats(raw: RawAid["beats"]): AidBeat[] {
  const blank = (s: string) => s.trim() || null;
  return raw.map((b) => {
    const text = blank(b.text);
    return {
      phrase: b.phrase.trim(),
      action: b.action,
      target: text ? null : b.target,
      text,
      value: blank(b.value),
      unit: blank(b.unit),
      row: b.value.trim() && b.row > 0 ? b.row : null,
      icon: isAidIcon(b.icon) ? b.icon : null,
    };
  });
}

function toAid(a: RawAid, code: string, wpm: number): VisualAid {
  const blank = (s: string) => s.trim() || null;
  const beats = a.kind === "M" ? toBeats(a.beats) : [];
  const segment = a.kind === "M" ? blank(a.segment) : null;
  return {
    kind: a.kind,
    code,
    anchor: a.anchor.trim(),
    idea: a.kind === "M" ? blank(a.idea) : null,
    title: a.title.trim(),
    definition: a.kind === "C" ? blank(a.definition) : null,
    elements:
      a.kind === "M"
        ? elementsFromBeats(beats)
        : a.kind === "L"
          ? a.elements.map((e) => ({ text: e.text.trim(), anchor: blank(e.anchor) }))
          : [],
    rows: a.kind === "M" ? rowsFromBeats(beats) : [],
    footer: a.kind === "M" ? blank(a.footer) : null,
    // La duración es la del segmento dicho al ritmo del canal (12.5), no la que estime Claude.
    durationS: a.kind === "M" ? motionSeconds(segment, wpm) : null,
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
    segment,
    aidCase: a.kind === "M" ? a.case : null,
    beats,
  };
}
