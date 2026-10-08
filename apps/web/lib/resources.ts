import { formatsFor } from "@planificador/motion";
import type { AidKind, VisualAid } from "@planificador/core";
import type { AidRenderView, VisualAidView } from "./data/visual-aids";
import type { ThumbnailDesignView } from "./data/thumbnails";

/**
 * Los recursos del episodio (Fase 3 · paso 5): lo que el editor baja para
 * armar el video. Sale de las vistas de ayudas y miniaturas que la página ya
 * carga, sin consultas ni firmas nuevas.
 */

export type AidFormat = AidRenderView["format"];
export type ResourceType = "motion" | "aid" | "thumbnail";
export type ResourceStatus =
  | "ready"
  | "outdated"
  | "rendering"
  | "queued"
  | "failed"
  | "missing"
  | "unchosen";

export type EpisodeResource = {
  key: string;
  type: ResourceType;
  /** M1, C2, L1… o la letra de la miniatura. */
  code: string;
  title: string;
  format: AidFormat | "thumbnail";
  fileName: string | null;
  bytes: number | null;
  status: ResourceStatus;
  downloadUrl: string | null;
};

/** La ayuda de la vista como `VisualAid` de core (para el plan en texto). */
export const toVisualAid = (a: VisualAidView): VisualAid => ({
  kind: a.kind,
  code: a.code,
  anchor: a.anchor,
  idea: a.idea,
  title: a.title,
  definition: a.definition,
  elements: a.elements,
  rows: a.rows,
  footer: a.footer,
  durationS: a.durationS,
  piece: a.piece,
  scores: a.scores,
  vertical: a.vertical,
});

/** El formato en el nombre del archivo, en español. */
export const FORMAT_FILE: Record<AidFormat, string> = {
  horizontal: "horizontal",
  vertical: "vertical",
  green: "verde",
  alpha: "transparente",
};

export function aidFileName(episodeCode: string, aidCode: string, format: AidFormat) {
  return `${episodeCode}-${aidCode}-${FORMAT_FILE[format]}.${format === "alpha" ? "webm" : "mp4"}`;
}

const STATUS_ORDER: ResourceStatus[] = [
  "failed",
  "missing",
  "unchosen",
  "outdated",
  "queued",
  "rendering",
  "ready",
];

function renderStatus(r: AidRenderView): ResourceStatus {
  if (r.status === "ready") return r.outdated ? "outdated" : "ready";
  return r.status;
}

export function episodeResources(
  episodeCode: string,
  aids: VisualAidView[],
  designs: ThumbnailDesignView[],
): EpisodeResource[] {
  const rows: EpisodeResource[] = [];
  const approved = aids.filter((a) => a.status === "approved");
  // Primero las M (motion graphics), después las C y L (ayudas).
  for (const type of ["motion", "aid"] as const) {
    for (const a of approved.filter((x) => (x.kind === "M") === (type === "motion"))) {
      for (const format of formatsFor({ kind: a.kind as AidKind, vertical: a.vertical })) {
        const r = a.renders.find((x) => x.format === format);
        rows.push({
          key: `${a.id}-${format}`,
          type,
          code: a.code,
          title: a.title,
          format,
          fileName: aidFileName(episodeCode, a.code, format),
          bytes: r?.status === "ready" ? r.bytes : null,
          status: r ? renderStatus(r) : "missing",
          downloadUrl: r?.status === "ready" ? r.downloadUrl : null,
        });
      }
    }
  }
  const chosen = designs.flatMap((d) =>
    d.versions.filter((v) => v.chosen).map((v) => ({ letter: d.letter, v })),
  )[0];
  rows.push(
    chosen
      ? {
          key: chosen.v.id,
          type: "thumbnail",
          code: chosen.letter,
          title: chosen.v.text?.lines.join(" ") ?? "",
          format: "thumbnail",
          fileName: chosen.v.fileName,
          bytes: null,
          status: chosen.v.status === "ready" ? "ready" : "failed",
          downloadUrl: chosen.v.downloadUrl,
        }
      : {
          key: "thumbnail",
          type: "thumbnail",
          code: "",
          title: "",
          format: "thumbnail",
          fileName: null,
          bytes: null,
          status: "unchosen",
          downloadUrl: null,
        },
  );
  return rows;
}

/** Cuántos están listos y el peor estado (para el resumen). */
export function resourcesSummary(rows: EpisodeResource[]) {
  const ready = rows.filter((r) => r.status === "ready").length;
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
    ResourceStatus,
    number
  >;
  for (const r of rows) counts[r.status]++;
  return { ready, total: rows.length, counts, done: ready === rows.length };
}

const FOLDER: Record<ResourceType, string> = {
  motion: "motion-graphics",
  aid: "ayudas",
  thumbnail: "miniatura",
};

/** Los archivos del zip «Descargar todo»: todo lo que tiene archivo, en carpetas por tipo. */
export function zipEntries(episodeCode: string, rows: EpisodeResource[]) {
  const root = `${episodeCode}-recursos`;
  return rows
    .filter((r) => r.downloadUrl && r.fileName && (r.status === "ready" || r.status === "outdated"))
    .map((r) => ({
      path: `${root}/${FOLDER[r.type]}/${r.fileName}`,
      url: r.downloadUrl!,
    }));
}
