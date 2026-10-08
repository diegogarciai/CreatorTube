import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { thumbnailLetter } from "@planificador/ai";
import type { Database } from "@planificador/db";
import { blockersFor, type EpisodeDependents, type Target } from "../dependencies";

/**
 * Lo que ya está generado en el episodio, para saber qué bloquea cada
 * «Rehacer». Sirve con el cliente del usuario (página) o el de servicio
 * (acciones, que lo vuelven a comprobar antes de rehacer o borrar).
 */
export async function episodeDependents(
  db: SupabaseClient<Database>,
  episodeId: string,
  currentScriptRunId: string | null,
): Promise<EpisodeDependents> {
  const [{ count: plan }, { data: renders }, { count: ideas }, { data: thumbs }, podcast] =
    await Promise.all([
      db
        .from("visual_aids")
        .select("id", { count: "exact", head: true })
        .eq("episode_id", episodeId),
      db.from("aid_renders").select("aid:visual_aids(code)").eq("episode_id", episodeId),
      db
        .from("thumbnail_ideas")
        .select("id", { count: "exact", head: true })
        .eq("episode_id", episodeId),
      db.from("episode_assets").select("design_idx").eq("episode_id", episodeId),
      currentScriptRunId
        ? db
            .from("script_step_runs")
            .select("id", { count: "exact", head: true })
            .eq("run_id", currentScriptRunId)
            .eq("step", "podcast_script")
            .eq("status", "succeeded")
        : Promise.resolve({ count: 0 }),
    ]);
  const codes = [...new Set((renders ?? []).map((r) => r.aid?.code).filter(Boolean))] as string[];
  const letters = [...new Set((thumbs ?? []).map((t) => t.design_idx))]
    .sort((a, b) => a - b)
    .map(thumbnailLetter);
  return {
    script: Boolean(currentScriptRunId),
    podcast: Boolean(podcast.count),
    plan: Boolean(plan),
    renders: codes.sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    ideas: Boolean(ideas),
    thumbnails: letters,
  };
}

/** Si algo generado depende de `target` (lo vuelven a comprobar las acciones). */
export async function hasBlockers(
  db: SupabaseClient<Database>,
  target: Target,
  episodeId: string,
  currentScriptRunId: string | null,
) {
  const deps = await episodeDependents(db, episodeId, currentScriptRunId);
  return blockersFor(target, deps).length > 0;
}

/** Si hay una tarea de estos tipos en marcha para el episodio. */
export async function taskRunning(
  db: SupabaseClient<Database>,
  episodeId: string,
  kinds: string[],
) {
  const { count } = await db
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("episode_id", episodeId)
    .in("kind", kinds)
    .in("status", ["queued", "running"]);
  return Boolean(count);
}
