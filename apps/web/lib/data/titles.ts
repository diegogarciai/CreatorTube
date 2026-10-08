import "server-only";
import { parseAssets, thumbnailLetter } from "@planificador/ai";
import { getSupabase } from "../auth";

export type TitleOption = {
  title: string;
  /** De dónde sale: el JSON de Publicación o la miniatura A, B o C. */
  source: { kind: "assets" } | { kind: "thumbnail"; letter: string; text: string };
};

/**
 * Los títulos del episodio: los 3 del JSON de Publicación y los de los textos
 * elegidos para las miniaturas A, B y C.
 */
export async function loadTitleOptions(episode: {
  id: string;
  currentScriptRunId: string | null;
}): Promise<TitleOption[]> {
  const supabase = await getSupabase();
  const [{ data: json }, { data: ideas }] = await Promise.all([
    episode.currentScriptRunId
      ? supabase
          .from("script_step_runs")
          .select("body")
          .eq("run_id", episode.currentScriptRunId)
          .eq("step", "assets_json")
          .eq("status", "succeeded")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("thumbnail_ideas")
      .select("title, text, slot")
      .eq("episode_id", episode.id)
      .not("slot", "is", null)
      .order("slot"),
  ]);
  const fromAssets = (parseAssets(json?.body)?.titulos ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .map((title): TitleOption => ({ title, source: { kind: "assets" } }));
  const fromThumbnails = (ideas ?? [])
    .filter((i) => i.title.trim() && i.slot !== null)
    .map(
      (i): TitleOption => ({
        title: i.title.trim(),
        source: { kind: "thumbnail", letter: thumbnailLetter(i.slot!), text: i.text },
      }),
    );
  return [...fromAssets, ...fromThumbnails];
}
