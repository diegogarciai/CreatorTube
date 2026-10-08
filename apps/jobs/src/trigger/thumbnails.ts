import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  geminiConfigFromEnv,
  generateImage,
  imageCostUsd,
  imagePrompt,
  parseAssets,
  scoreThumbnail,
  thumbnailBriefs,
  usdToCredits,
  type GeminiConfig,
  type ImageInput,
  type StreamClient,
  type TextSide,
  type ThumbnailText,
} from "@planificador/ai";
import { parseBrandKit } from "@planificador/core";
import type { Database, Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { composeThumbnail, prepareReference } from "../lib/compose-thumbnail";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

const BUCKET = "channel-media";
const MAX_PRESENTER_REFS = 4;
const MAX_PRODUCT_REFS = 3;

/**
 * Miniaturas de un episodio: brief con Claude, imagen sin texto con Gemini,
 * texto de la marca puesto por la app y calificación con Claude. Las filas de
 * `episode_assets` de la tarea dicen qué hacer con cada una; si la tarea se
 * reintenta, no repite lo que ya quedó guardado.
 */
export const thumbnailsTask = schemaTask({
  id: "thumbnails",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 900,
  // Cada imagen cuesta: un solo reintento si falla la red.
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runThumbnails(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
      geminiConfigFromEnv(process.env),
    ),
});

type AssetUpdate = Database["public"]["Tables"]["episode_assets"]["Update"];

type AssetRow = {
  id: string;
  design_idx: number;
  status: string;
  base_path: string | null;
  path: string | null;
  text: Json | null;
  text_side: string | null;
  prompt: string | null;
  note: string | null;
  score: Json | null;
  credits: number;
};

export async function runThumbnails(
  taskId: string,
  db: ServiceClient,
  anthropic: StreamClient,
  gemini: GeminiConfig,
  fetchImpl: typeof fetch = fetch,
) {
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

      const [{ data: rows }, { data: episode }, { data: channel }, { data: kitRow }] =
        await Promise.all([
          db
            .from("episode_assets")
            .select(
              "id, design_idx, status, base_path, path, text, text_side, prompt, note, score, credits",
            )
            .eq("task_id", taskId)
            .order("design_idx"),
          db.from("episodes").select("title, current_script_run_id").eq("id", episodeId).single(),
          db.from("channels").select("name, profile").eq("id", channelId).single(),
          db
            .from("brand_kits")
            .select("colors, fonts, style, thumbnail_style, logo_path")
            .eq("channel_id", channelId)
            .maybeSingle(),
        ]);
      if (!episode || !channel) throw new Error("No se encontró el episodio");
      const pending = ((rows ?? []) as AssetRow[]).filter(
        (r) => r.status !== "ready" && r.status !== "failed",
      );
      if (!pending.length) return { ready: 0 };

      const fail = (ids: string[], message: string) =>
        db.from("episode_assets").update({ status: "failed", error: message }).in("id", ids);
      const update = (id: string, patch: AssetUpdate) =>
        db.from("episode_assets").update(patch).eq("id", id);
      const charge = async (
        kind: string,
        usd: number,
        meta: Record<string, unknown>,
      ): Promise<number> => {
        const credits = usdToCredits(usd);
        await db.from("usage_ledger").insert({
          workspace_id: task.workspace_id,
          channel_id: channelId,
          task_id: taskId,
          user_id: task.requested_by,
          kind,
          credits,
          cost_usd: usd,
          meta: meta as Json,
        });
        return credits;
      };

      // Los diseños salen del JSON de Publicación del guion actual.
      const { data: json } = episode.current_script_run_id
        ? await db
            .from("script_step_runs")
            .select("body")
            .eq("run_id", episode.current_script_run_id)
            .eq("step", "assets_json")
            .eq("status", "succeeded")
            .maybeSingle()
        : { data: null };
      const assets = parseAssets(json?.body);
      if (!assets?.miniaturas.length) {
        await fail(
          pending.map((r) => r.id),
          "errors.no_publication_assets",
        );
        return { ready: 0 };
      }

      const kit = parseBrandKit(kitRow);
      const ai = await loadAiSettings(db, task.workspace_id);
      const claude = ai.config("thumbnails");
      const presenter =
        ((channel.profile ?? {}) as { hosts?: string[] }).hosts?.[0] || channel.name;
      const toGenerate = pending.filter((r) => !r.base_path);

      // Referencias: fotos del presentador y del producto, reducidas.
      let presenterRefs: ImageInput[] = [];
      let productRefs: ImageInput[] = [];
      if (toGenerate.length) {
        await report.progress(0.05, "Preparando las fotos de referencia");
        const [{ data: photos }, { data: refs }] = await Promise.all([
          db
            .from("presenter_photos")
            .select("path")
            .eq("channel_id", channelId)
            .order("created_at")
            .limit(MAX_PRESENTER_REFS),
          db
            .from("episode_refs")
            .select("path")
            .eq("episode_id", episodeId)
            .order("created_at")
            .limit(MAX_PRODUCT_REFS),
        ]);
        const load = async (paths: string[]) =>
          Promise.all(
            paths.map(async (p) => {
              const { data, error: dlError } = await db.storage.from(BUCKET).download(p);
              if (dlError || !data) throw new Error(`No se pudo leer ${p}`);
              const jpg = await prepareReference(Buffer.from(await data.arrayBuffer()));
              return { mime: "image/jpeg", data: jpg };
            }),
          );
        presenterRefs = await load((photos ?? []).map((p) => p.path));
        productRefs = await load((refs ?? []).map((p) => p.path));
        if (!presenterRefs.length) {
          await fail(
            toGenerate.map((r) => r.id),
            "errors.no_presenter_photos",
          );
        }
      }
      const work = pending.filter((r) => r.base_path || presenterRefs.length);

      // Brief de las que todavía no tienen escena ni texto, en una llamada.
      const needBrief = work.filter((r) => !r.base_path && !r.prompt);
      if (needBrief.length) {
        await report.progress(0.1, "Escribiendo el brief de las miniaturas");
        const out = await thumbnailBriefs(anthropic, claude, {
          designs: needBrief.map((r) => ({
            idx: r.design_idx,
            design: assets.miniaturas[r.design_idx] ?? assets.miniaturas[0]!,
            note: r.note,
          })),
          kit: {
            canvas: kit.colors.canvas,
            glow: kit.colors.glow,
            amberDeep: kit.colors.amberDeep,
            accent: kit.colors.accent,
            thumbnailStyle: kit.thumbnailStyle,
          },
          episodeTitle: episode.title,
          verdict: assets.postura,
          presenter,
          productRefs: productRefs.length,
        });
        const usd = ai.costUsd(out.usage, out.model);
        const credits = await charge("thumbnail_brief", usd, {
          model: out.model,
          ...out.usage,
          ai_usd: usd,
        });
        for (const [i, row] of needBrief.entries()) {
          const b = out.briefs[i]!;
          row.prompt = imagePrompt({
            scene: b.scene,
            textSide: b.textSide,
            presenterRefs: presenterRefs.length,
            productRefs: productRefs.length,
            kit: kit.colors,
          });
          row.text = { lines: b.lines, accent: b.accent };
          row.text_side = b.textSide;
          row.credits += credits / needBrief.length;
          await update(row.id, {
            prompt: row.prompt,
            text: row.text,
            text_side: row.text_side,
            credits: row.credits,
          });
        }
      }

      let ready = 0;
      for (const [i, row] of work.entries()) {
        const step = (k: number) => 0.15 + (0.85 * (i + k / 3)) / work.length;
        const label = `Miniatura ${i + 1} de ${work.length}`;
        try {
          const text = row.text as ThumbnailText;
          const side = (row.text_side ?? "left") as TextSide;
          const design = assets.miniaturas[row.design_idx] ?? assets.miniaturas[0]!;
          let base: Buffer | null = null;

          if (!row.base_path) {
            await report.progress(step(0), `${label}: generando la imagen`);
            await update(row.id, { status: "generating" });
            const image = await generateImage(
              gemini,
              { prompt: row.prompt ?? "", references: [...presenterRefs, ...productRefs] },
              fetchImpl,
            );
            base = image.bytes;
            const ext = image.mime === "image/jpeg" ? "jpg" : "png";
            const basePath = `${channelId}/episodes/${episodeId}/thumbnails/${row.id}-base.${ext}`;
            const { error: upError } = await db.storage
              .from(BUCKET)
              .upload(basePath, base, { contentType: image.mime, upsert: true });
            if (upError) throw upError;
            const usd = imageCostUsd(gemini, image.usage);
            row.credits += await charge("thumbnail_image", usd, {
              model: gemini.model,
              images: image.usage.images,
              input_tokens: image.usage.inputTokens,
              image_usd: usd,
            });
            row.base_path = basePath;
            await update(row.id, {
              base_path: basePath,
              model: gemini.model,
              credits: row.credits,
            });
          }

          let jpg: Buffer | null = null;
          if (!row.path) {
            await report.progress(step(1), `${label}: poniendo el texto`);
            await update(row.id, { status: "composing" });
            if (!base) {
              const { data, error: dlError } = await db.storage
                .from(BUCKET)
                .download(row.base_path!);
              if (dlError || !data) throw new Error("No se pudo leer la imagen base");
              base = Buffer.from(await data.arrayBuffer());
            }
            jpg = await composeThumbnail(base, {
              lines: text.lines,
              accent: text.accent,
              side,
              colors: { text: kit.colors.text, accent: kit.colors.accent },
            });
            const path = `${channelId}/episodes/${episodeId}/thumbnails/${row.id}.jpg`;
            const { error: upError } = await db.storage
              .from(BUCKET)
              .upload(path, jpg, { contentType: "image/jpeg", upsert: true });
            if (upError) throw upError;
            row.path = path;
            await update(row.id, { path });
          }

          if (!row.score) {
            await report.progress(step(2), `${label}: calificando`);
            await update(row.id, { status: "scoring" });
            if (!jpg) {
              const { data, error: dlError } = await db.storage.from(BUCKET).download(row.path!);
              if (dlError || !data) throw new Error("No se pudo leer la miniatura");
              jpg = Buffer.from(await data.arrayBuffer());
            }
            const out = await scoreThumbnail(anthropic, claude, {
              image: jpg,
              mime: "image/jpeg",
              design,
              text,
              topic: episode.title,
              verdict: assets.postura,
            });
            const usd = ai.costUsd(out.usage, out.model);
            row.credits += await charge("thumbnail_score", usd, {
              model: out.model,
              ...out.usage,
              ai_usd: usd,
            });
            await update(row.id, { score: out.score as unknown as Json, credits: row.credits });
          }

          await update(row.id, { status: "ready", error: null });
          ready++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await fail([row.id], message.slice(0, 500));
        }
      }
      await report.progress(1, `${ready} de ${pending.length} listas`);
      return { ready };
    },
    db,
  );
}
