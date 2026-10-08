import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  checkIdentity,
  identityCorrection,
  geminiConfigFromEnv,
  generateImage,
  imageCostUsd,
  locateSubjects,
  maxPresenterRefs,
  parseAssets,
  schemeImagePrompt,
  scoreThumbnail,
  thumbnailBriefs,
  usdToCredits,
  type GeminiConfig,
  type ImageInput,
  type StreamClient,
  type SubjectBox,
  type ThumbnailText,
} from "@planificador/ai";
import {
  assignScenarios,
  hasFace,
  hasVerdict,
  IDENTITY_ATTEMPTS,
  IDENTITY_WARNINGS,
  isIdentityWarning,
  isSchemeId,
  parseBrandKit,
  SCENARIOS,
  THUMBNAIL_SCHEMES,
  type Scenario,
  type SchemeId,
} from "@planificador/core";
import type { Database, Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { composeScheme, mobilePreview, prepareReference } from "../lib/compose-thumbnail";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

const BUCKET = "channel-media";
const MAX_PRODUCT_REFS = 3;

/**
 * Miniaturas de un episodio con la guía de miniaturas v1.0: cada una sale de
 * un texto elegido con su esquema (A–F). Brief con Claude, imagen sin texto
 * con Gemini (prompt base + esquema), texto en la zona del esquema puesto por
 * la app y calificación con Claude. Las filas de `episode_assets` de la tarea
 * dicen qué hacer con cada una; si la tarea se reintenta, no repite lo que ya
 * quedó guardado.
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
  idea_id: string | null;
  scheme: string | null;
  scenario: string | null;
  mirror: boolean;
  layout_warnings: string[];
  prompt: string | null;
  note: string | null;
  score: Json | null;
  credits: number;
};

const isScenario = (v: unknown): v is Scenario =>
  typeof v === "string" && (SCENARIOS as readonly string[]).includes(v);

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
              "id, design_idx, status, base_path, path, text, idea_id, scheme, scenario, mirror, layout_warnings, prompt, note, score, credits",
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

      // El veredicto y los títulos salen del JSON de Publicación del guion actual.
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
      if (!assets) {
        await fail(
          pending.map((r) => r.id),
          "errors.no_publication_assets",
        );
        return { ready: 0 };
      }
      // La guía: sin veredicto («el punto»), no se diseña la miniatura.
      if (!hasVerdict(assets.postura)) {
        await fail(
          pending.map((r) => r.id),
          "errors.no_verdict",
        );
        return { ready: 0 };
      }

      // El esquema de cada fila: el suyo (versiones de texto) o el del texto elegido.
      const ideaIds = pending.flatMap((r) => (r.idea_id ? [r.idea_id] : []));
      const { data: ideas } = ideaIds.length
        ? await db
            .from("thumbnail_ideas")
            .select("id, scheme, angle, text, accent, scene, emotion")
            .in("id", ideaIds)
        : { data: [] };
      const ideaOf = (r: AssetRow) => ideas?.find((i) => i.id === r.idea_id) ?? null;
      for (const r of pending) {
        const scheme = r.scheme ?? ideaOf(r)?.scheme ?? null;
        r.scheme = isSchemeId(scheme) ? scheme : null;
      }
      const noScheme = pending.filter((r) => !r.scheme);
      if (noScheme.length)
        await fail(
          noScheme.map((r) => r.id),
          "errors.thumbnail_needs_idea",
        );
      const schemed = pending.filter((r) => r.scheme);
      const schemeOf = (r: AssetRow) => r.scheme as SchemeId;

      const kit = parseBrandKit(kitRow);
      const ai = await loadAiSettings(db, task.workspace_id);
      const claude = ai.config("thumbnails");
      const presenter =
        ((channel.profile ?? {}) as { hosts?: string[] }).hosts?.[0] || channel.name;
      const toGenerate = schemed.filter((r) => !r.base_path);

      // Referencias: fotos del presentador y del producto, reducidas.
      let presenterRefs: ImageInput[] = [];
      let productRefs: ImageInput[] = [];
      let productLabels: string[] = [];
      {
        await report.progress(0.05, "Preparando las fotos de referencia");
        const [{ data: photos }, { data: refs }] = await Promise.all([
          db
            .from("presenter_photos")
            .select("path")
            .eq("channel_id", channelId)
            .order("created_at")
            .limit(maxPresenterRefs(gemini.model)),
          toGenerate.length
            ? db
                .from("episode_refs")
                .select("path, label")
                .eq("episode_id", episodeId)
                .order("created_at")
                .limit(MAX_PRODUCT_REFS)
            : Promise.resolve({ data: [] as { path: string; label: string | null }[] }),
        ]);
        // Cada referencia lleva su etiqueta: así Gemini sabe que todas las
        // fotos del presentador son la misma persona.
        const load = async (paths: string[], label: (n: number) => string) =>
          Promise.all(
            paths.map(async (p, i) => {
              const { data, error: dlError } = await db.storage.from(BUCKET).download(p);
              if (dlError || !data) throw new Error(`No se pudo leer ${p}`);
              const jpg = await prepareReference(Buffer.from(await data.arrayBuffer()));
              return { mime: "image/jpeg", data: jpg, label: label(i + 1) };
            }),
          );
        presenterRefs = await load(
          (photos ?? []).map((p) => p.path),
          (n) => `Reference photo of the presenter ${n} (the same real person in every photo):`,
        );
        productRefs = await load(
          (refs ?? []).map((p) => p.path),
          (n) => `Product photo ${n}:`,
        );
        productLabels = (refs ?? []).map((r, i) => r.label?.trim() || `producto ${i + 1}`);
        // Sin las fotos que pide su esquema, la miniatura no se puede generar.
        const missing = toGenerate.filter(
          (r) =>
            (hasFace(schemeOf(r)) && !presenterRefs.length) ||
            THUMBNAIL_SCHEMES[schemeOf(r)].productPhotos > productRefs.length,
        );
        for (const r of missing)
          await fail(
            [r.id],
            hasFace(schemeOf(r)) && !presenterRefs.length
              ? "errors.no_presenter_photos"
              : "errors.scheme_needs_product",
          );
        for (const r of missing) r.status = "failed";
      }
      const work = schemed.filter((r) => r.status !== "failed");
      /** Las referencias que van a Gemini según el esquema. */
      const refsFor = (scheme: SchemeId) => ({
        presenter: hasFace(scheme) ? presenterRefs : [],
        product: scheme === "D" ? productRefs.slice(0, 2) : productRefs,
      });

      // Brief de las que todavía no tienen escena, en una llamada.
      const needBrief = work.filter((r) => !r.base_path && !r.prompt);
      if (needBrief.length) {
        await report.progress(0.1, "Escribiendo el brief de las miniaturas");
        // Rotación: ni los escenarios de las otras tarjetas ni los de los
        // últimos 3 videos del canal.
        const [{ data: others }, { data: recent }] = await Promise.all([
          db
            .from("episode_assets")
            .select("design_idx, scenario, created_at")
            .eq("episode_id", episodeId)
            .neq("task_id", taskId)
            .not("scenario", "is", null)
            .order("created_at", { ascending: false }),
          db
            .from("episode_assets")
            .select("episode_id, scenario, created_at")
            .eq("channel_id", channelId)
            .neq("episode_id", episodeId)
            .eq("chosen", true)
            .not("scenario", "is", null)
            .order("created_at", { ascending: false })
            .limit(3),
        ]);
        const briefSlots = new Set(needBrief.map((r) => r.design_idx));
        const setOthers = [
          ...new Map(
            (others ?? [])
              .filter((o) => !briefSlots.has(o.design_idx))
              .map((o) => [o.design_idx, o.scenario] as const),
          ).values(),
        ];
        const scenarios = assignScenarios(needBrief.map(schemeOf), [
          ...setOthers.filter((x): x is string => Boolean(x)),
          ...(recent ?? []).flatMap((r) => (r.scenario ? [r.scenario] : [])),
        ]);
        needBrief.forEach((r, i) => {
          r.scenario = isScenario(r.scenario) ? r.scenario : scenarios[i]!;
        });

        const out = await thumbnailBriefs(anthropic, claude, {
          items: needBrief.map((r) => {
            const idea = ideaOf(r);
            const text = r.text as ThumbnailText | null;
            return {
              idx: r.design_idx,
              scheme: schemeOf(r),
              scenario: r.scenario as Scenario,
              text: text?.lines.join(" ") ?? idea?.text ?? "",
              accent: text?.accent ?? idea?.accent ?? "",
              angle: idea?.angle ?? "",
              emotion: idea?.emotion ?? "",
              idea: idea?.scene ?? "",
              note: r.note,
            };
          }),
          kit: {
            canvas: kit.colors.canvas,
            glow: kit.colors.glow,
            amberDeep: kit.colors.amberDeep,
            accent: kit.colors.accent,
            cream: kit.colors.cream,
            grid: kit.colors.grid,
            thumbnailStyle: kit.thumbnailStyle,
          },
          episodeTitle: episode.title,
          verdict: assets.postura,
          presenter,
          productRefs: productLabels,
        });
        const usd = ai.costUsd(out.usage, out.model);
        const credits = await charge("thumbnail_brief", usd, {
          model: out.model,
          ...out.usage,
          ai_usd: usd,
        });
        for (const [i, row] of needBrief.entries()) {
          const b = out.briefs[i]!;
          const scheme = schemeOf(row);
          const refs = refsFor(scheme);
          row.mirror = b.mirror;
          row.prompt = schemeImagePrompt({
            scheme,
            scene: b.scene,
            scenario: row.scenario as Scenario,
            mirror: b.mirror,
            presenterRefs: refs.presenter.length,
            productRefs: refs.product.length,
            kit: kit.colors,
          });
          const idea = ideaOf(row);
          // El texto es el elegido tal cual: la app lo parte en líneas.
          if (!row.text && idea) row.text = { lines: [idea.text], accent: idea.accent };
          row.credits += credits / needBrief.length;
          await update(row.id, {
            scheme,
            scenario: row.scenario,
            mirror: row.mirror,
            prompt: row.prompt,
            text: row.text,
            credits: row.credits,
          });
        }
      }

      let ready = 0;
      for (const [i, row] of work.entries()) {
        const step = (k: number) => 0.15 + (0.85 * (i + k / 3)) / work.length;
        const label = `Miniatura ${i + 1} de ${work.length}`;
        const scheme = schemeOf(row);
        try {
          const text = row.text as ThumbnailText;
          let base: Buffer | null = null;
          let warnings: string[] | null = null;

          if (!row.base_path) {
            await report.progress(step(0), `${label}: generando la imagen`);
            await update(row.id, { status: "generating" });
            const refs = refsFor(scheme);
            // Hasta que la persona sea el presentador (o, sin cara, que no haya
            // nadie): cada intento fallido vuelve a Gemini con lo que salió mal.
            type Attempt = { bytes: Buffer; mime: string; ok: boolean; likeness: number };
            let best: Attempt | null = null;
            let notes = "";
            for (let attempt = 1; attempt <= IDENTITY_ATTEMPTS; attempt++) {
              if (attempt > 1)
                await report.progress(step(0), `${label}: otra imagen (intento ${attempt})`);
              const prompt =
                attempt === 1
                  ? (row.prompt ?? "")
                  : `${row.prompt ?? ""}\n${identityCorrection(scheme, notes)}`;
              let image: Awaited<ReturnType<typeof generateImage>>;
              try {
                image = await generateImage(
                  gemini,
                  { prompt, references: [...refs.presenter, ...refs.product] },
                  fetchImpl,
                );
              } catch (err) {
                // Si falla un reintento, se queda la mejor imagen que ya se pagó.
                if (best) break;
                throw err;
              }
              const usd = imageCostUsd(gemini, image.usage);
              row.credits += await charge("thumbnail_image", usd, {
                model: gemini.model,
                images: image.usage.images,
                input_tokens: image.usage.inputTokens,
                image_usd: usd,
                attempt,
              });
              let check = { ok: true, likeness: 10, notes: "" };
              try {
                const preview = await sharp(image.bytes)
                  .resize(1024, 576, { fit: "cover" })
                  .jpeg({ quality: 85 })
                  .toBuffer();
                const out = await checkIdentity(anthropic, claude, {
                  image: preview,
                  mime: "image/jpeg",
                  scheme,
                  references: refs.presenter.slice(0, 2),
                });
                check = out.check;
                const checkUsd = ai.costUsd(out.usage, out.model);
                row.credits += await charge("thumbnail_identity", checkUsd, {
                  model: out.model,
                  ...out.usage,
                  ai_usd: checkUsd,
                  attempt,
                  ok: check.ok,
                  likeness: check.likeness,
                });
              } catch {
                // Si la verificación falla, la imagen sigue: la calificación revisa la cara.
              }
              const current = { bytes: image.bytes, mime: image.mime, ...check };
              if (!best || current.likeness > best.likeness) best = current;
              if (check.ok) {
                best = current;
                break;
              }
              notes = check.notes;
            }
            const chosen = best!;
            base = chosen.bytes;
            if (!chosen.ok) {
              row.layout_warnings = [
                hasFace(scheme) ? IDENTITY_WARNINGS.face : IDENTITY_WARNINGS.person,
              ];
            }
            const ext = chosen.mime === "image/jpeg" ? "jpg" : "png";
            const basePath = `${channelId}/episodes/${episodeId}/thumbnails/${row.id}-base.${ext}`;
            const { error: upError } = await db.storage
              .from(BUCKET)
              .upload(basePath, base, { contentType: chosen.mime, upsert: true });
            if (upError) throw upError;
            row.base_path = basePath;
            await update(row.id, {
              base_path: basePath,
              model: gemini.model,
              layout_warnings: row.layout_warnings,
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
            // Claude ubica la cara y el producto: el texto no tapa el producto y
            // deja 40 px a la cara (si no cabe todo, manda el producto).
            let avoid: SubjectBox[] = [];
            {
              const preview = await sharp(base)
                .resize(1024, 576, { fit: "cover" })
                .jpeg({ quality: 80 })
                .toBuffer();
              try {
                const located = await locateSubjects(anthropic, claude, {
                  image: preview,
                  mime: "image/jpeg",
                });
                avoid = located.boxes;
                const usd = ai.costUsd(located.usage, located.model);
                row.credits += await charge("thumbnail_layout", usd, {
                  model: located.model,
                  ...located.usage,
                  ai_usd: usd,
                });
              } catch {
                // Sin ubicación, el texto va igual en la zona de su esquema.
              }
            }
            const composed = await composeScheme(base, {
              scheme,
              mirror: row.mirror,
              text: text.lines.join(" "),
              accent: text.accent,
              avoid,
              colors: { text: kit.colors.text, accent: kit.colors.accent },
            });
            jpg = composed.jpg;
            // Los avisos de identidad de la imagen se quedan con la versión.
            warnings = [...row.layout_warnings.filter(isIdentityWarning), ...composed.warnings];
            const path = `${channelId}/episodes/${episodeId}/thumbnails/${row.id}.jpg`;
            const { error: upError } = await db.storage
              .from(BUCKET)
              .upload(path, jpg, { contentType: "image/jpeg", upsert: true });
            if (upError) throw upError;
            row.path = path;
            row.text = { lines: composed.lines, accent: text.accent };
            await update(row.id, {
              path,
              text: row.text,
              layout_warnings: warnings,
              credits: row.credits,
            });
          }

          if (!row.score) {
            await report.progress(step(2), `${label}: calificando`);
            await update(row.id, { status: "scoring" });
            if (!jpg) {
              const { data, error: dlError } = await db.storage.from(BUCKET).download(row.path!);
              if (dlError || !data) throw new Error("No se pudo leer la miniatura");
              jpg = Buffer.from(await data.arrayBuffer());
            }
            if (!warnings) {
              const { data: saved } = await db
                .from("episode_assets")
                .select("layout_warnings")
                .eq("id", row.id)
                .single();
              warnings = saved?.layout_warnings ?? [];
            }
            const out = await scoreThumbnail(anthropic, claude, {
              image: jpg,
              mobile: await mobilePreview(jpg),
              mime: "image/jpeg",
              scheme,
              text: row.text as ThumbnailText,
              topic: episode.title,
              titles: assets.titulos,
              verdict: assets.postura,
              warnings,
              reference: presenterRefs[0] ?? null,
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
