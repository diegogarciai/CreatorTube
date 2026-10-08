import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { AiRefusalError, type AiConfig } from "./generate";
import type { PublicationAssets } from "./publication";
import type { StreamClient } from "./stages";

/**
 * Miniaturas (Fase 3 · paso 2). Claude escribe el brief de cada una (la escena
 * para Gemini, el texto en dos líneas y de qué lado va), Gemini pinta la
 * imagen sin texto, la app pone el texto de la marca y Claude la califica con
 * la sección 14 de las reglas.
 */

export type ThumbnailDesign = PublicationAssets["miniaturas"][number];
export type TextSide = "left" | "right";

/** El sistema A/B/C del manual: la pregunta, el dato y el veredicto. */
export const THUMBNAIL_LETTERS = ["A", "B", "C"] as const;
export const thumbnailLetter = (idx: number) => THUMBNAIL_LETTERS[idx] ?? String(idx + 1);

export type ThumbnailText = { lines: string[]; accent: string };

export type ThumbnailBrief = ThumbnailText & {
  idx: number;
  /** La escena para Gemini, en inglés y sin texto. */
  scene: string;
  textSide: TextSide;
};

/** Los colores del kit que importan para la imagen. */
export type ThumbnailKit = {
  canvas: string;
  glow: string;
  amberDeep: string;
  accent: string;
  thumbnailStyle: string;
};

const briefSchema = z.object({
  briefs: z.array(
    z.object({
      idx: z.number().int().describe("El índice de la miniatura, tal como llegó."),
      scene: z
        .string()
        .describe(
          "La escena para el generador de imágenes, en inglés: encuadre, lo que hace el presentador, su expresión, el producto, la luz y el fondo. Sin texto en la imagen.",
        ),
      lines: z
        .array(z.string())
        .describe("El texto de la miniatura repartido en 2 líneas, con sus palabras exactas."),
      accent: z
        .string()
        .describe("La única palabra que va en naranja, tal como aparece en las líneas."),
      text_side: z
        .enum(["left", "right"])
        .describe("El lado donde va el texto; el presentador y el producto quedan del otro lado."),
    }),
  ),
});

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Dos líneas como máximo y una palabra en naranja que sí esté en el texto. */
export function normalizeText(lines: readonly string[], accent: string): ThumbnailText {
  const all = lines.flatMap(words);
  const clean =
    all.length === 0
      ? []
      : lines.length === 2 && lines.every((l) => words(l).length)
        ? lines.map((l) => words(l).join(" "))
        : [
            all.slice(0, Math.ceil(all.length / 2)).join(" "),
            all.slice(Math.ceil(all.length / 2)).join(" "),
          ].filter(Boolean);
  const bare = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const found = all.find((w) => bare(w) && bare(w) === bare(accent));
  return { lines: clean, accent: found ?? all.at(-1) ?? "" };
}

export interface BriefInput {
  designs: { idx: number; design: ThumbnailDesign; note?: string | null }[];
  kit: ThumbnailKit;
  episodeTitle: string;
  verdict: string;
  presenter: string;
  productRefs: number;
}

/** El brief de varias miniaturas en una sola llamada. */
export async function thumbnailBriefs(
  client: StreamClient,
  config: AiConfig,
  input: BriefInput,
): Promise<{ briefs: ThumbnailBrief[]; usage: UsageTotals; model: string }> {
  const system = [
    "Diriges el arte de las miniaturas de YouTube de un canal de tecnología. Para cada miniatura escribes el brief de la imagen y repartes el texto.",
    "La imagen la genera otro modelo a partir de fotos reales del presentador; el texto lo pone después la app con la tipografía de la marca. Por eso la escena nunca lleva letras, números, logos, flechas, emojis ni marcos.",
    "Estilo de la marca: fondo oscuro, luz cálida lateral y un halo naranja detrás; expresión natural, nunca cara de asombro; el presentador de medio cuerpo al menos en el veredicto; el producto real, grande e idéntico a sus fotos si las hay.",
    "La escena deja libre casi la mitad del ancho del lado del texto, con fondo oscuro y limpio para que se lea. Las tres miniaturas no repiten la misma distribución.",
    "El texto usa exactamente las palabras del campo «texto» de la miniatura, en 2 líneas, y una sola palabra en naranja: la que carga la emoción o el dato.",
  ].join("\n");
  const user = [
    `Episodio: ${input.episodeTitle}`,
    `Veredicto del guion: ${input.verdict || "(sin veredicto)"}`,
    `Presentador: ${input.presenter}`,
    `Fotos del producto disponibles: ${input.productRefs}`,
    `Estilo de miniaturas del canal: ${input.kit.thumbnailStyle}`,
    "",
    ...input.designs.map(({ idx, design, note }) =>
      [
        `## Miniatura ${thumbnailLetter(idx)} (idx ${idx})`,
        `texto: ${design.texto}`,
        `escena: ${design.escena}`,
        `expresión: ${design.expresion}`,
        `protagonista: ${design.protagonista}`,
        `composición: ${design.composicion}`,
        `ayuda visual: ${design.ayuda_visual}`,
        `emoción: ${design.emocion}`,
        ...(note?.trim() ? [`Indicación del presentador para esta versión: ${note.trim()}`] : []),
      ].join("\n"),
    ),
  ].join("\n");

  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 4_000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low", format: betaZodOutputFormat(briefSchema) },
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
  if (!parsed) throw new Error("El brief de las miniaturas llegó incompleto");
  const briefs = input.designs.map(({ idx, design }, i) => {
    const b = parsed.briefs.find((x) => x.idx === idx) ?? parsed.briefs[i];
    const text = normalizeText(b?.lines ?? [design.texto], b?.accent ?? "");
    return {
      idx,
      scene: b?.scene?.trim() || design.escena,
      textSide: b?.text_side ?? (i % 2 ? "left" : "right"),
      ...text,
    } satisfies ThumbnailBrief;
  });
  return { briefs, usage: addUsage(emptyUsage(), res.usage), model: res.model };
}

/**
 * La instrucción completa para Gemini: qué son las referencias, la escena y
 * las reglas fijas de la marca (que no dependen de lo que escriba el brief).
 */
export function imagePrompt(input: {
  scene: string;
  textSide: TextSide;
  presenterRefs: number;
  productRefs: number;
  kit: Pick<ThumbnailKit, "canvas" | "glow" | "amberDeep">;
}): string {
  const free = input.textSide === "left" ? "left" : "right";
  const subject = input.textSide === "left" ? "right" : "left";
  const refs = [
    input.presenterRefs
      ? `The first ${input.presenterRefs} image(s) are reference photos of the presenter: keep the person's face, facial hair, hairline and skin tone identical; do not beautify them or change their age.`
      : "",
    input.productRefs
      ? `The next ${input.productRefs} image(s) show the real product: reproduce it exactly (shape, color, ports, logos on the device itself).`
      : "",
  ].filter(Boolean);
  return [
    "Create a photorealistic YouTube thumbnail photograph, 16:9.",
    ...refs,
    `Scene: ${input.scene}`,
    `Composition: the presenter and the product occupy the ${subject} half; keep the ${free} ~45% of the frame as clean dark background for a headline that will be added later.`,
    `Look: dark background close to ${input.kit.canvas}, warm side light on the face, a soft radial orange glow (${input.kit.glow} fading to ${input.kit.amberDeep}) behind the subject, natural expression, sharp focus on face and product.`,
    "Strictly no text, letters, numbers, captions, logos, watermarks, arrows, emojis, frames or borders anywhere in the image. No surprised face, no exaggerated expression, no neon, RGB or blue lighting.",
  ].join("\n");
}

export const SCORE_CRITERIA = [
  "scroll",
  "product",
  "text",
  "emotion",
  "face",
  "contrast",
  "verdict",
  "clean",
] as const;
export type ScoreCriterion = (typeof SCORE_CRITERIA)[number];

const scoreSchema = z.object({
  score: z.number().int().min(0).max(10).describe("Nota de 0 a 10."),
  criteria: z.array(
    z.object({
      key: z.enum(SCORE_CRITERIA),
      ok: z.boolean(),
      note: z.string().describe("Una frase corta en español."),
    }),
  ),
  improve: z.string().describe("Qué cambiar para la próxima versión, en una o dos frases."),
});

export type ThumbnailScore = z.infer<typeof scoreSchema>;

/** Claude mira la miniatura terminada y la califica con la sección 14. */
export async function scoreThumbnail(
  client: StreamClient,
  config: AiConfig,
  input: {
    image: Buffer;
    mime: string;
    design: ThumbnailDesign;
    text: ThumbnailText;
    verdict: string;
  },
): Promise<{ score: ThumbnailScore; usage: UsageTotals; model: string }> {
  const system = [
    "Calificas miniaturas de YouTube de un canal de tecnología con las reglas del canal. Respondes en español.",
    "Criterios (uno por clave):",
    "- scroll: vista sola en el celular, sin el título, dice en un segundo de qué se habla.",
    "- product: el producto real se ve grande y reconocible.",
    "- text: 2 a 4 palabras legibles que nombran algo concreto (producto, componente, cifra o precio), una sola palabra en naranja y nunca amarillo.",
    "- emotion: despierta una emoción por lo que está en juego (pagar de más, quedarse corto, una sorpresa o un permiso).",
    "- face: la cara del presentador se ve clara, de frente o en tres cuartos, bien iluminada, con expresión natural.",
    "- contrast: el texto y el sujeto se separan bien del fondo oscuro.",
    "- verdict: no contradice el veredicto del episodio ni promete lo que el video no entrega.",
    "- clean: sin flechas, emojis, marcos, logos inventados ni letras raras dentro de la imagen.",
    "La nota es de 0 a 10; 8 o más significa lista para publicar.",
  ].join("\n");
  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 2_000,
    system,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mime as "image/jpeg",
              data: input.image.toString("base64"),
            },
          },
          {
            type: "text",
            text: [
              `Texto de la miniatura: ${input.text.lines.join(" / ")} (en naranja: ${input.text.accent})`,
              `Escena pedida: ${input.design.escena}`,
              `Emoción buscada: ${input.design.emocion}`,
              `Veredicto del episodio: ${input.verdict || "(sin veredicto)"}`,
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(scoreSchema) },
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
  if (!parsed) throw new Error("La calificación de la miniatura llegó incompleta");
  return { score: parsed, usage: addUsage(emptyUsage(), res.usage), model: res.model };
}
