import "server-only";
import {
  parseAssets,
  thumbnailLetter,
  type ThumbnailScore,
  type ThumbnailText,
} from "@planificador/ai";
import {
  episodeKind,
  hasVerdict,
  isSchemeId,
  RECOMMENDED_SETS,
  type EpisodeKind,
  type SchemeId,
  type ThumbnailOptions,
} from "@planificador/core";
import { getSupabase } from "../auth";
import { MEDIA_BUCKET, SIGNED_URL_SECONDS } from "../media";

export type ThumbnailVersion = {
  id: string;
  status: "queued" | "generating" | "composing" | "scoring" | "ready" | "failed";
  url: string | null;
  downloadUrl: string | null;
  /** El nombre con que se descarga: código del episodio y letra. */
  fileName: string;
  text: ThumbnailText | null;
  /** El esquema de la guía (null en versiones de antes de la guía). */
  scheme: SchemeId | null;
  /** Texto del otro lado (A y C). */
  mirror: boolean;
  scenario: string | null;
  /** Lo que no se pudo cumplir de la composición. */
  warnings: string[];
  /** Lo que el presentador quitó de esta versión. */
  options: ThumbnailOptions;
  score: ThumbnailScore | null;
  chosen: boolean;
  error: string | null;
  note: string | null;
  /** Sale de otra versión con el texto cambiado (sin imagen nueva). */
  textEdit: boolean;
  createdAt: string;
};

export type ThumbnailDesignView = {
  idx: number;
  letter: string;
  /** El texto elegido de la lista para esta tarjeta (con su esquema), si hay. */
  idea: ThumbnailIdeaView | null;
  versions: ThumbnailVersion[];
};

export type ThumbnailIdeaView = {
  id: string;
  scheme: SchemeId;
  /** El título del video que acompaña a este texto (vacío en tandas viejas). */
  title: string;
  angle: string;
  text: string;
  accent: string;
  scene: string;
  emotion: string;
  /** La tarjeta donde está (0 a 2), o null. */
  slot: number | null;
};

export type ThumbnailsView = {
  /** Los textos propuestos para elegir los 3 ángulos. */
  ideas: ThumbnailIdeaView[];
  /** La tarea que propone los textos está en marcha. */
  ideasActive: boolean;
  /** La última propuesta falló (mensaje), si es la más reciente. */
  ideasError: string | null;
  /** Sin el JSON de Publicación no hay veredicto ni títulos. */
  missingAssets: boolean;
  /** El guion tiene veredicto («el punto»); sin él no se diseña. */
  verdict: boolean;
  /** El tipo de episodio y su set recomendado de esquemas. */
  kind: EpisodeKind;
  recommended: SchemeId[];
  designs: ThumbnailDesignView[];
  refs: { id: string; label: string | null; url: string | null }[];
  presenterPhotos: number;
  /** Hay una tarea de miniaturas en marcha. */
  active: boolean;
};

const ACTIVE = new Set(["queued", "generating", "composing", "scoring"]);

/** Las miniaturas del episodio con sus versiones y URLs firmadas. */
export async function loadThumbnailsView(episode: {
  id: string;
  channelId: string;
  code: string;
  currentScriptRunId: string | null;
}): Promise<ThumbnailsView> {
  const supabase = await getSupabase();
  const [
    { data: json },
    { data: rows },
    { data: refs },
    { count: presenterPhotos },
    { data: ideas },
    { data: ideasTask },
  ] = await Promise.all([
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
      .from("episode_assets")
      .select(
        "id, design_idx, status, path, text, scheme, mirror, scenario, layout_warnings, no_text, no_person, no_product, score, chosen, error, note, source_id, created_at, task:tasks(status, error)",
      )
      .eq("episode_id", episode.id)
      .eq("kind", "thumbnail")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("episode_refs")
      .select("id, path, label")
      .eq("episode_id", episode.id)
      .order("created_at"),
    supabase
      .from("presenter_photos")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", episode.channelId),
    supabase
      .from("thumbnail_ideas")
      .select("id, scheme, title, angle, text, accent, scene, emotion, slot, position")
      .eq("episode_id", episode.id)
      .order("position"),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("episode_id", episode.id)
      .eq("kind", "thumbnail_ideas")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const assets = parseAssets(json?.body);
  const storage = supabase.storage.from(MEDIA_BUCKET);
  const paths = [
    ...(rows ?? []).flatMap((r) => (r.path ? [r.path] : [])),
    ...(refs ?? []).map((r) => r.path),
  ];
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await storage.createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  let active = false;
  const versions = await Promise.all(
    (rows ?? []).map(async (r): Promise<{ idx: number; version: ThumbnailVersion }> => {
      // Si la tarea se cayó, la fila que quedó a medias cuenta como fallida.
      const taskDead = r.task?.status === "failed" || r.task?.status === "canceled";
      let status = r.status as ThumbnailVersion["status"];
      let error = r.error;
      if (ACTIVE.has(status)) {
        if (taskDead) {
          status = "failed";
          error = r.task?.error ?? "errors.unknown";
        } else active = true;
      }
      const name = `${episode.code}-${thumbnailLetter(r.design_idx)}-${r.id.slice(0, 6)}.jpg`;
      const download =
        status === "ready" && r.path
          ? ((await storage.createSignedUrl(r.path, SIGNED_URL_SECONDS, { download: name })).data
              ?.signedUrl ?? null)
          : null;
      return {
        idx: r.design_idx,
        version: {
          id: r.id,
          status,
          url: r.path ? (urls.get(r.path) ?? null) : null,
          downloadUrl: download,
          fileName: name,
          text: (r.text as ThumbnailText | null) ?? null,
          scheme: isSchemeId(r.scheme) ? r.scheme : null,
          mirror: r.mirror,
          scenario: r.scenario,
          warnings: r.layout_warnings ?? [],
          options: { noText: r.no_text, noPerson: r.no_person, noProduct: r.no_product },
          score: (r.score as unknown as ThumbnailScore | null) ?? null,
          chosen: r.chosen,
          error,
          note: r.note,
          textEdit: Boolean(r.source_id),
          createdAt: r.created_at,
        },
      };
    }),
  );

  // Los textos de la lista: primero los que están en las tarjetas (A, B, C).
  const ideaViews: ThumbnailIdeaView[] = [...(ideas ?? [])]
    .filter((i) => isSchemeId(i.scheme))
    .sort((a, b) => (a.slot ?? 9) - (b.slot ?? 9) || a.position - b.position)
    .map((i) => ({
      id: i.id,
      scheme: i.scheme as SchemeId,
      title: i.title,
      angle: i.angle,
      text: i.text,
      accent: i.accent,
      scene: i.scene,
      emotion: i.emotion,
      slot: i.slot,
    }));
  const kind = episodeKind(assets?.tipo);

  return {
    missingAssets: !assets,
    verdict: hasVerdict(assets?.postura),
    kind,
    recommended: RECOMMENDED_SETS[kind],
    designs: [0, 1, 2].map((idx) => ({
      idx,
      letter: thumbnailLetter(idx),
      idea: ideaViews.find((i) => i.slot === idx) ?? null,
      versions: versions.filter((v) => v.idx === idx).map((v) => v.version),
    })),
    ideas: ideaViews,
    ideasActive: ideasTask?.status === "queued" || ideasTask?.status === "running",
    ideasError: ideasTask?.status === "failed" ? (ideasTask.error ?? "errors.unknown") : null,
    refs: (refs ?? []).map((r) => ({ id: r.id, label: r.label, url: urls.get(r.path) ?? null })),
    presenterPhotos: presenterPhotos ?? 0,
    active,
  };
}
