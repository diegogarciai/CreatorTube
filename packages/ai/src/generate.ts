import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import {
  buildDirectionPrompt,
  checkDirection,
  directionOutputSchema,
  toQuestions,
  type DirectionInput,
  type DirectionQuestion,
} from "./direction";

/** El modelo se elige en el entorno (AI_MODEL), no en el código. */
export interface AiConfig {
  model: string;
  /** Respaldo automático del servidor ante negativas (AI_FALLBACKS=off lo apaga). */
  fallbacks?: boolean;
}

export function aiConfigFromEnv(env: Record<string, string | undefined>): AiConfig {
  const model = env.AI_MODEL?.trim();
  if (!model) throw new Error("Falta AI_MODEL en las variables de entorno del motor de tareas");
  return { model, fallbacks: env.AI_FALLBACKS?.trim().toLowerCase() !== "off" };
}

export class AiRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`El modelo no quiso responder${category ? ` (${category})` : ""}`);
    this.name = "AiRefusalError";
  }
}

export class DirectionRulesError extends Error {
  constructor(readonly problems: string[]) {
    super(`Las preguntas no cumplen las reglas: ${problems.join(" ")}`);
    this.name = "DirectionRulesError";
  }
}

export interface DirectionResult {
  reading: string;
  questions: DirectionQuestion[];
  usage: UsageTotals;
  model: string;
}

/** Mínimo de la interfaz del SDK que se usa; en las pruebas se inyecta un falso. */
export type MessagesClient = Pick<Anthropic, "messages">;

/**
 * Pide las preguntas con salida estructurada y revisa las reglas que se pueden
 * contar. Si no cumplen, pide una corrección una sola vez.
 */
export async function generateDirection(
  client: MessagesClient,
  config: AiConfig,
  input: DirectionInput,
): Promise<DirectionResult> {
  const { system, user } = buildDirectionPrompt(input);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  let usage = emptyUsage();
  let problems: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.parse({
      model: config.model,
      max_tokens: 8000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: "low", format: zodOutputFormat(directionOutputSchema) },
    });
    usage = addUsage(usage, res.usage);
    if (res.stop_reason === "refusal") {
      const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
      throw new AiRefusalError(details?.category ?? null);
    }
    const out = res.parsed_output;
    problems = out ? checkDirection(out) : ["La respuesta llegó incompleta."];
    if (out && problems.length === 0) {
      return {
        reading: out.reading.trim(),
        questions: toQuestions(out),
        usage,
        model: config.model,
      };
    }
    messages.push(
      { role: "assistant", content: res.content },
      {
        role: "user",
        content: `Corrige estas fallas y entrega de nuevo la respuesta completa:\n- ${problems.join("\n- ")}`,
      },
    );
  }
  throw new DirectionRulesError(problems);
}
