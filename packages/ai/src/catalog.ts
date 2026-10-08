import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { AiRefusalError, type AiConfig } from "./generate";
import { cleanKeywords, type Pillar } from "./publication";
import type { StreamClient } from "./stages";

/**
 * Importación desde YouTube (paso 7): por cada video publicado, Claude propone
 * el pilar, las keywords y la postura a partir del título, la descripción y
 * las etiquetas. Va en lotes para que las instrucciones se paguen una vez.
 */

export const CATALOG_BATCH = 20;

export type CatalogVideo = {
  id: string;
  title: string;
  description: string;
  tags: string[];
};

export type CatalogResult = {
  id: string;
  pillar: Pillar | null;
  keywords: string[];
  stance: string;
};

const schema = z.object({
  videos: z.array(
    z.object({
      id: z.string(),
      pilar: z
        .string()
        .nullable()
        .describe("El nombre exacto de uno de los pilares del canal, o null si ninguno encaja."),
      keywords: z
        .array(z.string())
        .describe("De 6 a 8 búsquedas reales de la gente, en minúsculas, sin repetir."),
      postura: z
        .string()
        .describe(
          "La postura del presentador en una frase, solo si el título o la descripción la dicen; si no, vacío.",
        ),
    }),
  ),
});

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** La descripción recortada: lo que importa está al principio. */
const clip = (s: string, max = 1500) => (s.length > max ? `${s.slice(0, max)}…` : s);

export interface CatalogInput {
  presenter: string;
  channelName: string;
  pillars: readonly Pillar[];
  videos: readonly CatalogVideo[];
}

/** Clasifica un lote de videos con salida estructurada. */
export async function classifyVideos(
  client: StreamClient,
  config: AiConfig,
  input: CatalogInput,
): Promise<{ results: CatalogResult[]; usage: UsageTotals; model: string }> {
  const system = [
    `Clasificas los videos ya publicados del canal de YouTube «${input.channelName}», que presenta ${input.presenter}.`,
    "Por cada video entregas el pilar, las keywords y la postura, para el panel de planificación del canal.",
    "- Pilar: uno de los pilares del canal, con su nombre exacto; null si ninguno encaja.",
    "- Keywords: de 6 a 8 búsquedas que la gente escribe en YouTube para encontrar ese video, en minúsculas. Usa las etiquetas como pista, no las copies.",
    "- Postura: la opinión del presentador en una frase, solo si el título o la descripción la dicen. Si no la dicen, deja el texto vacío: no la inventes.",
    `Pilares del canal: ${input.pillars.length ? input.pillars.map((p) => p.name).join(", ") : "el canal no tiene pilares"}.`,
  ].join("\n");
  const videos = input.videos
    .map((v) =>
      [
        `### VIDEO ${v.id}`,
        `Título: ${v.title}`,
        v.tags.length ? `Etiquetas: ${v.tags.join(", ")}` : "",
        `Descripción: ${clip(v.description.trim()) || "(sin descripción)"}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  const cache = { type: "ephemeral" as const };
  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 8_000,
    system: [{ type: "text", text: system, cache_control: cache }],
    messages: [
      {
        role: "user",
        content: `${videos}\n\nClasifica cada video de arriba, con su id exacto.`,
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
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
  if (!parsed) throw new Error("La clasificación de los videos llegó incompleta");

  // Solo los videos pedidos, una vez cada uno; el pilar tiene que existir.
  const asked = new Set(input.videos.map((v) => v.id));
  const results = new Map<string, CatalogResult>();
  for (const v of parsed.videos) {
    if (!asked.has(v.id) || results.has(v.id)) continue;
    results.set(v.id, {
      id: v.id,
      pillar: v.pilar ? (input.pillars.find((p) => fold(p.name) === fold(v.pilar!)) ?? null) : null,
      keywords: cleanKeywords(v.keywords.map((k) => k.toLowerCase())),
      stance: v.postura.trim(),
    });
  }
  return {
    results: [...results.values()],
    usage: addUsage(emptyUsage(), res.usage),
    model: res.model,
  };
}
