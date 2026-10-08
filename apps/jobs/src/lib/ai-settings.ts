import {
  aiConfigFor,
  isAiStage,
  pricesFor,
  usageCostUsd,
  type AiConfig,
  type AiStage,
  type ModelPrice,
  type UsageTotals,
  type WorkspaceAiSettings,
} from "@planificador/ai";
import type { ServiceClient } from "./supabase";

/** Los modelos del espacio (Administración) y los precios del catálogo. */
export interface AiSettings {
  settings: WorkspaceAiSettings | null;
  catalog: ModelPrice[];
  /** El modelo y el respaldo de una etapa. */
  config(stage: AiStage): AiConfig;
  /** Lo que costó una llamada, al precio del modelo que respondió. */
  costUsd(usage: UsageTotals, model: string): number;
}

export async function loadAiSettings(db: ServiceClient, workspaceId: string): Promise<AiSettings> {
  const [{ data: row }, { data: models }] = await Promise.all([
    db
      .from("workspace_ai_settings")
      .select("default_model, stage_models")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db.from("ai_models").select("id, input_price_usd, output_price_usd"),
  ]);
  const stageModels = Object.fromEntries(
    Object.entries((row?.stage_models ?? {}) as Record<string, unknown>).filter(
      (e): e is [AiStage, string] => isAiStage(e[0]) && typeof e[1] === "string" && e[1] !== "",
    ),
  );
  const settings: WorkspaceAiSettings | null = row
    ? { defaultModel: row.default_model, stageModels }
    : null;
  const catalog: ModelPrice[] = (models ?? []).map((m) => ({
    id: m.id,
    inputPerMTok: m.input_price_usd === null ? null : Number(m.input_price_usd),
    outputPerMTok: m.output_price_usd === null ? null : Number(m.output_price_usd),
  }));
  return {
    settings,
    catalog,
    config: (stage) => aiConfigFor(process.env, settings, stage),
    costUsd: (usage, model) => usageCostUsd(usage, pricesFor(model, catalog, process.env)),
  };
}
