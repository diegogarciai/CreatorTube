import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { parseBrandKit, type AidElement, type VisualAid } from "@planificador/core";
import type { Json } from "@planificador/db";
import { renderSpec, type AidFormat } from "@planificador/motion";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

const BUCKET = "channel-media";
/** El máximo por archivo del plan gratis de Supabase. */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Render de las ayudas visuales aprobadas (Fase 3 · paso 4) con Remotion: M en
 * horizontal (y vertical si es la más fuerte), C y L en verde y transparente.
 * Las filas de `aid_renders` de la tarea dicen qué renderizar; si la tarea se
 * reintenta, no repite lo que ya quedó listo.
 */
export const renderAidsTask = schemaTask({
  id: "render_aids",
  schema: z.object({ taskId: z.uuid() }),
  machine: "medium-1x",
  maxDuration: 1800,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) => runRenderAids(taskId, serviceClient()),
});

/** El bundle de Remotion: copiado junto al motor en Trigger.dev, o el del repo en local. */
export function motionBundleDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MOTION_BUNDLE_DIR,
    resolve(process.cwd(), "packages/motion/build"),
    resolve(here, "../../../../packages/motion/build"),
  ].filter((p): p is string => Boolean(p));
  const dir = candidates.find((p) => existsSync(join(p, "index.html")));
  if (!dir) throw new Error("No se encontró el bundle de Remotion (packages/motion/build)");
  return dir;
}

/** Chrome Headless Shell: el de la imagen (REMOTION_CHROME_PATH) o el que descarga Remotion. */
async function browserExecutable() {
  const path = process.env.REMOTION_CHROME_PATH;
  if (path && existsSync(path)) return path;
  const { ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  return null;
}

type RenderRow = {
  id: string;
  visual_aid_id: string;
  format: string;
  status: string;
};

export async function runRenderAids(taskId: string, db: ServiceClient) {
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
      const episodeId = task.episode_id;
      const channelId = task.channel_id;

      const [{ data: rows }, { data: kitRow }] = await Promise.all([
        db.from("aid_renders").select("id, visual_aid_id, format, status").eq("task_id", taskId),
        db
          .from("brand_kits")
          .select("colors, fonts, style, thumbnail_style, logo_path")
          .eq("channel_id", channelId)
          .maybeSingle(),
      ]);
      const pending = ((rows ?? []) as RenderRow[]).filter((r) => r.status !== "ready");
      if (!pending.length) return { ready: 0 };
      const { data: aids } = await db
        .from("visual_aids")
        .select("*")
        .in(
          "id",
          pending.map((r) => r.visual_aid_id),
        );
      const colors = parseBrandKit(kitRow).colors;

      await report.progress(0.05, "Preparando el render");
      const { renderMedia, selectComposition } = await import("@remotion/renderer");
      const serveUrl = motionBundleDir();
      const browser = await browserExecutable();
      const work = await mkdtemp(join(tmpdir(), "aids-"));

      let ready = 0;
      let seconds = 0;
      try {
        for (const [i, row] of pending.entries()) {
          const a = aids?.find((x) => x.id === row.visual_aid_id);
          const label = `${a?.code ?? "Ayuda"} (${i + 1} de ${pending.length})`;
          try {
            if (!a) throw new Error("La ayuda ya no existe");
            const aid: VisualAid = {
              kind: a.kind as VisualAid["kind"],
              code: a.code,
              anchor: a.anchor,
              idea: a.idea,
              title: a.title,
              definition: a.definition,
              elements: (a.elements as AidElement[] | null) ?? [],
              rows: a.claim_rows,
              footer: a.footer,
              durationS: a.duration_s,
              piece: a.piece as VisualAid["piece"],
              vertical: a.vertical,
            };
            const spec = renderSpec(aid, colors, row.format as AidFormat);
            await report.progress(0.1 + (0.85 * i) / pending.length, `${label}: renderizando`);
            await db
              .from("aid_renders")
              .update({ status: "rendering", error: null })
              .eq("id", row.id);
            const composition = await selectComposition({
              serveUrl,
              id: spec.composition,
              inputProps: spec.props,
              ...(browser ? { browserExecutable: browser } : {}),
            });
            const out = join(work, `${a.code}-${row.format}.${spec.extension}`);
            // Si pasa de 50 MB, se comprime más (crf mayor).
            let bytes = 0;
            for (const crf of spec.alpha ? [32, 40, 48] : [20, 26, 32]) {
              await renderMedia({
                serveUrl,
                composition,
                inputProps: spec.props,
                codec: spec.codec,
                crf,
                outputLocation: out,
                overwrite: true,
                ...(spec.alpha
                  ? { imageFormat: "png" as const, pixelFormat: "yuva420p" as const }
                  : {}),
                ...(browser ? { browserExecutable: browser } : {}),
                chromiumOptions: { gl: "swangle" },
              });
              bytes = (await stat(out)).size;
              if (bytes <= MAX_BYTES) break;
            }
            if (bytes > MAX_BYTES) throw new Error("El video pasa de 50 MB aun comprimido");
            const path = `${channelId}/episodes/${episodeId}/aids/${a.code}-${row.format}.${spec.extension}`;
            const { error: upError } = await db.storage
              .from(BUCKET)
              .upload(path, await readFile(out), { contentType: spec.mime, upsert: true });
            if (upError) throw upError;
            const duration = composition.durationInFrames / composition.fps;
            seconds += duration;
            await db
              .from("aid_renders")
              .update({ status: "ready", path, bytes, duration_s: duration, error: null })
              .eq("id", row.id);
            ready++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await db
              .from("aid_renders")
              .update({ status: "failed", error: message.slice(0, 500) })
              .eq("id", row.id);
          }
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }

      // Tiempo de máquina de Trigger.dev, no de IA: se registra sin créditos.
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: channelId,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "render_aids",
        credits: 0,
        cost_usd: 0,
        meta: { renders: ready, seconds } as unknown as Json,
      });
      await report.progress(1, `${ready} de ${pending.length} listas`);
      return { ready };
    },
    db,
  );
}
