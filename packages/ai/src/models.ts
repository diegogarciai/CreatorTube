import { pricesFromEnv, type Prices } from "./cost";
import type { AiConfig } from "./generate";

/**
 * Modelos por espacio y por etapa (Administración). Los IDs no viven en el
 * código: salen del catálogo de la API y se guardan en la base. Sin ajustes,
 * vale la variable AI_MODEL del motor de tareas.
 */
export const AI_STAGES = [
  "direction",
  "study",
  "script",
  "verification",
  "publication",
  "podcast",
  "youtube_import",
  "thumbnails",
  "visual_aids",
  "distribution",
  "evaluation",
  "audit",
] as const;
export type AiStage = (typeof AI_STAGES)[number];

export const isAiStage = (v: unknown): v is AiStage =>
  typeof v === "string" && (AI_STAGES as readonly string[]).includes(v);

export type WorkspaceAiSettings = {
  defaultModel: string | null;
  stageModels: Partial<Record<AiStage, string>>;
};

/** Precio de un modelo del catálogo, en dólares por millón de tokens. */
export type ModelPrice = {
  id: string;
  inputPerMTok: number | null;
  outputPerMTok: number | null;
};

/** El modelo de una etapa: el de la etapa, el por defecto del espacio o AI_MODEL. */
export function resolveModel(
  env: Record<string, string | undefined>,
  settings: WorkspaceAiSettings | null,
  stage: AiStage,
): string {
  const model =
    settings?.stageModels[stage]?.trim() || settings?.defaultModel?.trim() || env.AI_MODEL?.trim();
  if (!model) {
    throw new Error(
      "No hay modelo de IA: elígelo en Administración o define AI_MODEL en el motor de tareas",
    );
  }
  return model;
}

/** La configuración de una llamada para una etapa del espacio. */
export function aiConfigFor(
  env: Record<string, string | undefined>,
  settings: WorkspaceAiSettings | null,
  stage: AiStage,
): AiConfig {
  return {
    model: resolveModel(env, settings, stage),
    fallbacks: env.AI_FALLBACKS?.trim().toLowerCase() !== "off",
  };
}

/** Lo que cuesta un modelo: el precio del catálogo si está escrito; si no, el de las variables. */
export function pricesFor(
  model: string,
  catalog: readonly ModelPrice[],
  env: Record<string, string | undefined>,
): Prices {
  const fallback = pricesFromEnv(env);
  const row = catalog.find((m) => m.id === model);
  return {
    inputPerMTok: row?.inputPerMTok ?? fallback.inputPerMTok,
    outputPerMTok: row?.outputPerMTok ?? fallback.outputPerMTok,
  };
}
