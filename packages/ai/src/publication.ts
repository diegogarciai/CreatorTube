import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { AiRefusalError, type AiConfig } from "./generate";
import type { Block, StreamClient } from "./stages";

/**
 * Publicación (etapa 4): los assets en JSON salen con salida estructurada a
 * partir de los assets y la ficha ya escritos. De ahí el panel toma las
 * keywords y el pilar del episodio.
 */

const assetsSchema = z.object({
  titulos: z.array(z.string()).describe("Los 3 títulos de los assets, de máximo 60 caracteres."),
  miniaturas: z.array(
    z.object({
      angulo: z
        .string()
        .describe(
          "El ángulo de la miniatura en 1 a 4 palabras: el dinero, el error, la comparación, el mito, el uso real, para quién sí…",
        ),
      texto: z.string(),
      escena: z.string(),
      expresion: z.string(),
      protagonista: z.string(),
      composicion: z.string(),
      ayuda_visual: z.string(),
      emocion: z.string(),
      titulo: z.string(),
      texto_alternativo: z.string(),
    }),
  ),
  descripcion: z.string().describe("La descripción de YouTube completa, sin los capítulos."),
  capitulos: z.array(z.object({ tiempo: z.string(), titulo: z.string() })),
  etiquetas: z.array(z.string()),
  comentario_fijado: z.string(),
  fuentes: z.array(z.object({ titulo: z.string(), url: z.string() })),
  postura: z.string(),
  tipo: z.string().describe("El tipo de episodio."),
  publico: z.string().describe("El perfil de espectador."),
  keywords: z
    .array(z.string())
    .describe("De 6 a 8 búsquedas reales de la gente, en minúsculas, sin repetir."),
  pilar: z
    .string()
    .nullable()
    .describe("El nombre exacto de uno de los pilares del canal, o null si no hay pilares."),
});

export type PublicationAssets = z.infer<typeof assetsSchema>;

// Lo guardado antes de que existiera el ángulo sigue siendo válido.
const storedAssetsSchema = assetsSchema.extend({
  miniaturas: z.array(
    assetsSchema.shape.miniaturas.element.extend({ angulo: z.string().default("") }),
  ),
});

export interface AssetsPrompt {
  system: string;
  shared: string;
  /** Los assets de publicación y la ficha del episodio. */
  blocks: Block[];
}

/** Pide los assets en JSON con salida estructurada. */
export async function extractAssets(
  client: StreamClient,
  config: AiConfig,
  prompt: AssetsPrompt,
): Promise<{ assets: PublicationAssets; usage: UsageTotals; model: string }> {
  const cache = { type: "ephemeral" as const };
  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 16_000,
    system: [{ type: "text", text: prompt.system, cache_control: cache }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt.shared, cache_control: cache },
          ...prompt.blocks.map((b) => ({
            type: "text" as const,
            text: `### BLOQUE: ${b.title}\n${b.body.trim()}`,
          })),
          {
            type: "text",
            text: [
              "PASO 4 de 4. Pasa a JSON los assets y la ficha de arriba, sin cambiar lo que ya dicen: títulos, miniaturas, descripción, capítulos, etiquetas, comentario fijado, fuentes, postura, tipo y público.",
              "Agrega de 6 a 8 keywords: lo que la gente escribe en el buscador para encontrar este video, en minúsculas.",
              "Elige el pilar del episodio entre los pilares del canal, con su nombre exacto.",
              "En cada miniatura, nombra su ángulo: las tres son ángulos distintos de la idea central del episodio.",
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(assetsSchema) },
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
  if (!parsed) throw new Error("Los assets en JSON llegaron incompletos");
  return { assets: parsed, usage: addUsage(emptyUsage(), res.usage), model: res.model };
}

/** Lee los assets guardados como texto del paso; null si no son JSON válido. */
export function parseAssets(body: string | null | undefined): PublicationAssets | null {
  if (!body?.trim()) return null;
  try {
    const out = storedAssetsSchema.safeParse(JSON.parse(body));
    return out.success ? out.data : null;
  } catch {
    return null;
  }
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Las keywords limpias: sin vacías ni repetidas, máximo 8. */
export function cleanKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const v = k.trim().replace(/\s+/g, " ");
    if (!v || seen.has(fold(v))) continue;
    seen.add(fold(v));
    out.push(v);
  }
  return out.slice(0, 8);
}

export type EpisodeTags = { keywords: string[]; pillar_id: string | null };
export type Pillar = { id: string; name: string };

/** Lo que proponen los assets y no coincide con el episodio. */
export type AssetsSuggestion = {
  keywords: string[] | null;
  pillar: Pillar | null;
};

/** Compara las keywords y el pilar de los assets con los del episodio. */
export function assetsSuggestion(
  episode: EpisodeTags,
  assets: Pick<PublicationAssets, "keywords" | "pilar">,
  pillars: readonly Pillar[],
): AssetsSuggestion {
  const keywords = cleanKeywords(assets.keywords);
  const same =
    keywords.length === episode.keywords.length &&
    keywords.every((k) => episode.keywords.some((e) => fold(e) === fold(k)));
  const pillar = assets.pilar
    ? (pillars.find((p) => fold(p.name) === fold(assets.pilar!)) ?? null)
    : null;
  return {
    keywords: keywords.length && !same ? keywords : null,
    pillar: pillar && pillar.id !== episode.pillar_id ? pillar : null,
  };
}

/**
 * Lo que se guarda en el episodio y lo que queda como sugerencia: las
 * keywords y el pilar solo se llenan si el episodio no los tiene.
 */
export function episodePatchFromAssets(
  episode: EpisodeTags,
  assets: Pick<PublicationAssets, "keywords" | "pilar">,
  pillars: readonly Pillar[],
): { patch: Partial<EpisodeTags>; suggestion: AssetsSuggestion } {
  const diff = assetsSuggestion(episode, assets, pillars);
  const patch: Partial<EpisodeTags> = {};
  const suggestion: AssetsSuggestion = { keywords: null, pillar: null };
  if (diff.keywords) {
    if (episode.keywords.length === 0) patch.keywords = diff.keywords;
    else suggestion.keywords = diff.keywords;
  }
  if (diff.pillar) {
    if (!episode.pillar_id) patch.pillar_id = diff.pillar.id;
    else suggestion.pillar = diff.pillar;
  }
  return { patch, suggestion };
}
