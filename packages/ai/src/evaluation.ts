import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  AUDIT_TOPIC_ACTIONS,
  suggestedVerdict,
  VERDICTS,
  type AuditProposals,
  type EvalMetric,
  type EvaluationData,
  type MetricComparison,
  type Verdict,
} from "@planificador/core";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { AiRefusalError, type AiConfig } from "./generate";
import type { StreamClient } from "./stages";

/**
 * Evaluación a 7 días y auditoría mensual (Fase 4 · paso 3). Los números los
 * calcula la app; Claude los lee, da el veredicto y lo que se aprende. La
 * auditoría junta las evaluaciones de un mes y propone ajustes a la guía del
 * guionista y a los temas, que una persona revisa.
 */

const METRIC_LABEL: Record<EvalMetric, string> = {
  views: "Vistas",
  averageViewPercentage: "% visto promedio",
  averageViewDurationS: "Duración media (s)",
  impressions: "Impresiones",
  ctr: "CTR",
  likes: "Me gusta",
  comments: "Comentarios",
  subscribersNet: "Suscriptores netos",
};

const fmt = (metric: EvalMetric, v: number | null) => {
  if (v === null) return "—";
  if (metric === "ctr") return `${(v * 100).toFixed(1)} %`;
  if (metric === "averageViewPercentage") return `${v.toFixed(1)} %`;
  return Math.round(v).toLocaleString("es");
};

/** La tabla de la primera semana contra la mediana, en Markdown. */
export function metricsTable(metrics: readonly MetricComparison[]): string {
  return [
    "| Métrica | Este episodio | Mediana | Diferencia | Episodios |",
    "| --- | --- | --- | --- | --- |",
    ...metrics.map(
      (m) =>
        `| ${METRIC_LABEL[m.metric]} | ${fmt(m.metric, m.value)} | ${fmt(m.metric, m.median)} | ${
          m.delta === null ? "—" : `${m.delta > 0 ? "+" : ""}${Math.round(m.delta * 100)} %`
        } | ${m.samples} |`,
    ),
  ].join("\n");
}

async function parse<S extends z.ZodType>(
  client: StreamClient,
  config: AiConfig,
  schema: S,
  system: string,
  user: string,
) {
  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 8_000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: betaZodOutputFormat(schema) },
    ...(config.fallbacks && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
  });
  if (res.stop_reason === "refusal") {
    const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new AiRefusalError(details?.category ?? null);
  }
  if (!res.parsed_output) throw new Error("La respuesta llegó incompleta");
  return {
    out: res.parsed_output as z.infer<S>,
    usage: addUsage(emptyUsage(), res.usage),
    model: res.model as string,
  };
}

const evaluationSchema = z.object({
  verdict: z.enum(VERDICTS).describe("above, inline o below respecto de la mediana del canal."),
  summary: z.string().describe("2 o 3 frases: cómo le fue y por qué, con los números."),
  learnings: z
    .array(z.string())
    .describe("Exactamente 3 aprendizajes concretos y accionables para los próximos episodios."),
});

export interface EvaluationInput {
  episodeTitle: string;
  stance: string;
  data: Pick<EvaluationData, "window" | "metrics" | "baseline" | "drops">;
}

const EVALUATION_SYSTEM = [
  "Evalúas la primera semana de un episodio de un canal de tecnología en YouTube, para su presentador, Diego. Respondes en español, tuteando, directo y sin adornos.",
  "Los números ya están calculados (la primera semana del episodio contra la mediana de la primera semana de los episodios anteriores del canal). No inventes cifras ni recalcules: usa las de la tabla.",
  "Veredicto: above (por encima), inline (en línea) o below (por debajo). Pesan más las vistas, el % visto y el CTR; con pocos episodios de comparación, dilo en el resumen.",
  "Los párrafos con más caída de retención dicen dónde se fue la gente: úsalos para explicar.",
  "Los 3 aprendizajes son concretos y se pueden aplicar en el próximo guion o empaque (título, miniatura, gancho, ritmo, estructura). Nada genérico como «sigue así».",
].join("\n");

/** El veredicto, el resumen y 3 aprendizajes de la primera semana. */
export async function evaluateEpisode(
  client: StreamClient,
  config: AiConfig,
  input: EvaluationInput,
): Promise<{
  verdict: Verdict;
  summary: string;
  learnings: string[];
  usage: UsageTotals;
  model: string;
}> {
  const { data } = input;
  const suggested = suggestedVerdict(data.metrics);
  const user = [
    `Episodio: ${input.episodeTitle}`,
    `Postura: ${input.stance.trim() || "(sin postura)"}`,
    `Primera semana: del ${data.window.from} al ${data.window.to}.`,
    `Comparado con ${data.baseline.count} episodios anteriores${
      data.baseline.codes.length ? ` (${data.baseline.codes.join(", ")})` : ""
    }.`,
    "",
    "## Primera semana contra la mediana",
    metricsTable(data.metrics),
    "",
    `Veredicto que sugieren los números: ${suggested ?? "sin datos para comparar"}.`,
    "",
    "## Párrafos con más caída de retención",
    data.drops.length
      ? data.drops
          .map((d) => `- Párrafo ${d.index + 1} (cae ${Math.round(d.drop * 100)} %): ${d.text}`)
          .join("\n")
      : "(todavía no hay retención)",
  ].join("\n");
  const { out, usage, model } = await parse(
    client,
    config,
    evaluationSchema,
    EVALUATION_SYSTEM,
    user,
  );
  return {
    verdict: out.verdict,
    summary: out.summary.trim(),
    learnings: out.learnings
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3),
    usage,
    model,
  };
}

const auditSchema = z.object({
  summary: z.string().describe("3 a 5 frases: qué funcionó y qué no en el mes, con evidencia."),
  guide: z
    .array(
      z.object({
        section: z.string().describe("El número y título de la sección de la guía, tal cual."),
        change: z.string().describe("Qué cambiar, concreto, en una o dos frases."),
        evidence: z.string().describe("En qué episodios y números se basa."),
      }),
    )
    .describe("De 0 a 5 ajustes a la guía del guionista. Solo si la evidencia lo sostiene."),
  topics: z
    .array(
      z.object({
        topic: z.string().describe("El tema o tipo de episodio, en pocas palabras."),
        action: z
          .enum(AUDIT_TOPIC_ACTIONS)
          .describe("more (hacer más), less (menos) o try (probar)."),
        evidence: z.string().describe("En qué episodios y números se basa."),
      }),
    )
    .describe("De 0 a 5 propuestas de temas."),
});

export interface AuditInput {
  month: string;
  evaluations: {
    code: string;
    title: string;
    publishedOn: string;
    pillar: string | null;
    verdict: Verdict | null;
    summary: string;
    learnings: string[];
    metrics: MetricComparison[];
    drops: string[];
  }[];
  /** La guía del guionista vigente (secciones con número y título). */
  guide: string;
  pillars: string[];
}

const AUDIT_SYSTEM = [
  "Auditas un mes de episodios de un canal de tecnología en YouTube para su presentador, Diego. Respondes en español, tuteando, directo.",
  "Tienes la evaluación a 7 días de cada episodio del mes (números contra la mediana del canal, veredicto, aprendizajes y párrafos con más caída) y la guía del guionista vigente.",
  "Propones ajustes concretos a secciones de la guía (citando la sección tal cual) y a los temas, cada uno con su evidencia. Si un patrón aparece en un solo episodio, no es patrón: dilo o no lo propongas. Si no hay nada que cambiar, la lista va vacía.",
  "No reescribes la guía: Diego decide y la edita. Nunca inventes cifras.",
].join("\n");

/** Propuestas del mes para revisar: ajustes a la guía y a los temas. */
export async function auditMonth(
  client: StreamClient,
  config: AiConfig,
  input: AuditInput,
): Promise<{ proposals: AuditProposals; usage: UsageTotals; model: string }> {
  const user = [
    `Mes: ${input.month}`,
    `Pilares del canal: ${input.pillars.join(", ") || "(sin pilares)"}`,
    "",
    "## Evaluaciones del mes",
    ...input.evaluations.map((e) =>
      [
        `### ${e.code} · ${e.title} (publicado el ${e.publishedOn}${e.pillar ? `, pilar ${e.pillar}` : ""})`,
        `Veredicto: ${e.verdict ?? "sin evaluar"}. ${e.summary}`,
        metricsTable(e.metrics),
        e.learnings.length ? `Aprendizajes: ${e.learnings.map((l) => `«${l}»`).join(" ")}` : "",
        e.drops.length ? `Caídas: ${e.drops.map((d) => `«${d}»`).join(" ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "",
    "## Guía del guionista vigente",
    input.guide.trim() || "(sin guía)",
  ].join("\n");
  const { out, usage, model } = await parse(client, config, auditSchema, AUDIT_SYSTEM, user);
  return {
    proposals: {
      summary: out.summary.trim(),
      guide: out.guide.slice(0, 5),
      topics: out.topics.slice(0, 5),
    },
    usage,
    model,
  };
}
