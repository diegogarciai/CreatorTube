import "server-only";
import {
  parseAssets,
  thumbnailLetter,
  type ThumbnailScore,
  type ThumbnailText,
} from "@planificador/ai";
import { getSupabase } from "../auth";
import { MEDIA_BUCKET, SIGNED_URL_SECONDS } from "../media";

export type ThumbnailVersion = {
  id: string;
  status: "queued" | "generating" | "composing" | "scoring" | "ready" | "failed";
  url: string | null;
  downloadUrl: string | null;
  text: ThumbnailText | null;
  side: "left" | "right";
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
  /** El ángulo de la miniatura (el dinero, el error…); vacío en JSON viejos. */
  angle: string;
  title: string;
  text: string;
  scene: string;
  emotion: string;
  versions: ThumbnailVersion[];
};

export type ThumbnailsView = {
  /** Sin el JSON de Publicación no hay diseños que generar. */
  missingAssets: boolean;
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
  const [{ data: json }, { data: rows }, { data: refs }, { count: presenterPhotos }] =
    await Promise.all([
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
          "id, design_idx, status, path, text, text_side, score, chosen, error, note, source_id, created_at, task:tasks(status, error)",
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
          text: (r.text as ThumbnailText | null) ?? null,
          side: r.text_side === "right" ? "right" : "left",
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

  return {
    missingAssets: !assets?.miniaturas.length,
    designs: (assets?.miniaturas ?? []).slice(0, 3).map((d, idx) => ({
      idx,
      letter: thumbnailLetter(idx),
      angle: d.angulo,
      title: d.titulo,
      text: d.texto,
      scene: d.escena,
      emotion: d.emocion,
      versions: versions.filter((v) => v.idx === idx).map((v) => v.version),
    })),
    refs: (refs ?? []).map((r) => ({ id: r.id, label: r.label, url: urls.get(r.path) ?? null })),
    presenterPhotos: presenterPhotos ?? 0,
    active,
  };
}
