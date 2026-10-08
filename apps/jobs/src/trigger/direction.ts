import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  aiConfigFromEnv,
  generateDirection,
  pricesFromEnv,
  usageCostUsd,
  usdToCredits,
  type DirectionInput,
  type MessagesClient,
} from "@planificador/ai";
import {
  DEFAULT_STAGE_SECTIONS,
  localDateKey,
  sectionsText,
  type GuideSection,
  type StageSections,
} from "@planificador/core";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/** Preguntas de dirección de un episodio: lee la guía y el contexto del canal. */
export const directionTask = schemaTask({
  id: "direction",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 300,
  // Cada intento cuesta: un solo reintento si falla la red o la API.
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runDirection(taskId, serviceClient(), new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
});

/** Lógica de la tarea, separada para probarla contra una base y una API de prueba. */
export async function runDirection(taskId: string, db: ServiceClient, anthropic: MessagesClient) {
  return runTracked(
    taskId,
    async (report) => {
      const { data: task, error } = await db
        .from("tasks")
        .select("workspace_id, channel_id, episode_id, requested_by")
        .eq("id", taskId)
        .single();
      if (error) throw error;
      if (!task.episode_id || !task.channel_id) throw new Error("La tarea no tiene episodio");

      await report.progress(0.1, "Leyendo el episodio y la guía");
      const { input, guideVersionId } = await loadDirectionInput(
        db,
        task.channel_id,
        task.episode_id,
      );

      await report.progress(0.3, "Preparando las preguntas");
      const result = await generateDirection(anthropic, aiConfigFromEnv(process.env), input);

      const usd = usageCostUsd(result.usage, pricesFromEnv(process.env));
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: task.channel_id,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "direction",
        credits: usdToCredits(usd),
        cost_usd: usd,
        meta: { model: result.model, ...result.usage },
      });

      await report.progress(0.9, "Guardando");
      const { error: saveError } = await db
        .from("episode_direction")
        .update({
          status: "ready",
          reading: result.reading,
          questions: result.questions,
          guide_version_id: guideVersionId,
          generated_at: new Date().toISOString(),
        })
        .eq("episode_id", task.episode_id);
      if (saveError) throw saveError;
      return { questions: result.questions.length };
    },
    db,
  );
}

async function loadDirectionInput(
  db: ServiceClient,
  channelId: string,
  episodeId: string,
): Promise<{ input: DirectionInput; guideVersionId: string }> {
  const [{ data: channel }, { data: episode }, { data: guide }] = await Promise.all([
    db.from("channels").select("name, timezone, profile").eq("id", channelId).single(),
    db
      .from("episodes")
      .select(
        "title, stance, stance_confirmed, notes, target_minutes, episode_type, own_measurements, sponsorship, pillar:pillars(name)",
      )
      .eq("id", episodeId)
      .single(),
    db
      .from("writer_guides")
      .select(
        "version:writer_guide_versions!writer_guides_current_version_fk(id, sections, stage_sections)",
      )
      .eq("channel_id", channelId)
      .maybeSingle(),
  ]);
  if (!channel || !episode) throw new Error("No se encontró el episodio");
  const version = guide?.version;
  if (!version) throw new Error("El canal no tiene guía del guionista");

  const stages = {
    ...DEFAULT_STAGE_SECTIONS,
    ...(version.stage_sections as Partial<StageSections>),
  };
  const guideSections = sectionsText(
    version.sections as unknown as GuideSection[],
    stages.direction,
  );

  const today = localDateKey(new Date(), channel.timezone);
  const [{ data: videos }, { data: next }] = await Promise.all([
    db
      .from("youtube_videos")
      .select("title, published_at")
      .eq("channel_id", channelId)
      .eq("privacy_status", "public")
      .not("title", "is", null)
      .order("published_at", { ascending: false })
      .limit(30),
    db
      .from("episodes")
      .select("title, publish_date")
      .eq("channel_id", channelId)
      .neq("id", episodeId)
      .is("archived_at", null)
      .in("status", ["scheduled", "editing", "to_record"])
      .gte("publish_date", today)
      .order("publish_date")
      .limit(1),
  ]);

  const profile = (channel.profile ?? {}) as { hosts?: string[] };
  return {
    guideVersionId: version.id,
    input: {
      guideSections,
      presenter: profile.hosts?.[0] || channel.name,
      title: episode.title,
      stance: episode.stance,
      stanceConfirmed: episode.stance_confirmed,
      notes: episode.notes,
      pillar: episode.pillar?.name ?? null,
      targetMinutes: episode.target_minutes,
      episodeType: episode.episode_type,
      ownMeasurements: episode.own_measurements,
      sponsorship: episode.sponsorship,
      published: (videos ?? []).map((v) => ({
        title: v.title ?? "",
        date: v.published_at?.slice(0, 10) ?? null,
      })),
      nextVideo: next?.[0] ? { title: next[0].title, date: next[0].publish_date } : null,
    },
  };
}
