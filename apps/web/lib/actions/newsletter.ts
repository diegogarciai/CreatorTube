"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  localDateKey,
  NEWSLETTER_MAX_COMMENTS,
  NEWSLETTER_MAX_EPISODES,
  parseBrandKit,
  startOfWeek,
  validateNewsletter,
  type NewsletterDraft,
} from "@planificador/core";
import { getSupabase, requireChannelPermission, requireUser } from "../auth";
import { EMAIL_CONFIGURED, emailFrom, sendBroadcast, sendEmail } from "../email";
import { startJob } from "../jobs";
import { renderNewsletterEmail } from "../newsletter-email";
import { createAdminClient } from "../supabase/admin";
import { NEWSLETTER_ESTIMATE_CREDITS } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Boletín (Fase 4 · paso 5): el semanal (resumen de los videos elegidos) y el
 * de cada episodio (las apreciaciones de Diego). Claude lo redacta a pedido;
 * quien tiene permiso de publicar lo edita, se manda una prueba y lo envía o
 * lo programa con Resend Broadcasts al segmento del canal.
 */

function revalidate(channelId: string, episodeId?: string | null) {
  revalidatePath(`/c/${channelId}/boletin`);
  if (episodeId) revalidatePath(`/c/${channelId}/episodios/${episodeId}`);
}

/** ¿Hay un boletín redactándose? (el semanal o el de ese episodio) */
async function drafting(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
  episodeId: string | null,
) {
  const q = admin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .eq("kind", "newsletter")
    .in("status", ["queued", "running"]);
  const { count } = await (episodeId ? q.eq("episode_id", episodeId) : q.is("episode_id", null));
  return Boolean(count);
}

async function enoughCredits(workspaceId: string) {
  const supabase = await getSupabase();
  const { data: credits } = await supabase.rpc("workspace_credits", { ws: workspaceId });
  return Number(credits?.[0]?.remaining ?? 0) >= NEWSLETTER_ESTIMATE_CREDITS;
}

const idsSchema = z.array(z.uuid()).min(1).max(NEWSLETTER_MAX_EPISODES);

/** Redacta (o rehace) el semanal de esta semana con los videos que se eligieron. */
export async function draftNewsletter(
  channelId: string,
  episodeIds: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await requireChannelPermission(channelId, "publish");
    const ids = [...new Set(idsSchema.parse(episodeIds))];
    const admin = createAdminClient();
    if (await drafting(admin, channelId, null)) return { ok: false, error: "errors.busy" };
    const { data: eps } = await admin
      .from("episodes")
      .select("id")
      .eq("channel_id", channelId)
      .eq("status", "published")
      .is("archived_at", null)
      .in("id", ids);
    if ((eps ?? []).length !== ids.length) return { ok: false, error: "errors.not_found" };
    if (!(await enoughCredits(ctx.channel.workspace_id)))
      return { ok: false, error: "errors.no_credits" };
    const weekStart = startOfWeek(localDateKey(new Date(), ctx.channel.timezone));
    const { data: current } = await admin
      .from("newsletters")
      .select("id, status")
      .eq("channel_id", channelId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (current && current.status !== "draft")
      return { ok: false, error: "errors.newsletter_locked" };
    let id = current?.id;
    if (id) {
      const { error } = await admin.from("newsletters").update({ episode_ids: ids }).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await admin
        .from("newsletters")
        .insert({ channel_id: channelId, kind: "weekly", week_start: weekStart, episode_ids: ids })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    await startJob(
      "newsletter",
      { workspaceId: ctx.channel.workspace_id, channelId, requestedBy: ctx.userId },
      async (taskId) => {
        await admin.from("newsletters").update({ task_id: taskId }).eq("id", id);
      },
    );
    revalidate(channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const episodeDraftSchema = z.object({
  notes: z.string().trim().max(4000),
  commentIds: z.array(z.string().min(1).max(100)).max(NEWSLETTER_MAX_COMMENTS),
});

/**
 * Redacta (o rehace) el boletín de un episodio: las apreciaciones de Diego
 * (sus notas) reforzadas con los comentarios que eligió.
 */
export async function draftEpisodeNewsletter(
  episodeId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const d = episodeDraftSchema.parse(input);
    const supabase = await getSupabase();
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, channel_id")
      .eq("id", episodeId)
      .single();
    if (!ep) throw new Error("errors.not_found");
    const ctx = await requireChannelPermission(ep.channel_id, "publish");
    const admin = createAdminClient();
    if (await drafting(admin, ep.channel_id, episodeId)) return { ok: false, error: "errors.busy" };
    const commentIds = d.commentIds.length
      ? (
          (
            await admin
              .from("youtube_comments")
              .select("comment_id")
              .eq("channel_id", ep.channel_id)
              .eq("episode_id", episodeId)
              .in("comment_id", d.commentIds)
          ).data ?? []
        ).map((c) => c.comment_id)
      : [];
    if (!(await enoughCredits(ctx.channel.workspace_id)))
      return { ok: false, error: "errors.no_credits" };
    const { data: current } = await admin
      .from("newsletters")
      .select("id, status")
      .eq("episode_id", episodeId)
      .maybeSingle();
    if (current && current.status !== "draft")
      return { ok: false, error: "errors.newsletter_locked" };
    let id = current?.id;
    if (id) {
      const { error } = await admin
        .from("newsletters")
        .update({ notes: d.notes, comment_ids: commentIds })
        .eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await admin
        .from("newsletters")
        .insert({
          channel_id: ep.channel_id,
          kind: "episode",
          episode_id: episodeId,
          episode_ids: [episodeId],
          notes: d.notes,
          comment_ids: commentIds,
        })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    await startJob(
      "newsletter",
      {
        workspaceId: ctx.channel.workspace_id,
        channelId: ep.channel_id,
        episodeId,
        requestedBy: ctx.userId,
      },
      async (taskId) => {
        await admin.from("newsletters").update({ task_id: taskId }).eq("id", id);
      },
    );
    revalidate(ep.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const draftSchema = z.object({
  subject: z.string().trim().max(200),
  preheader: z.string().trim().max(300),
  body: z.string().trim().max(20000),
  ctaText: z.string().trim().max(60),
  ctaUrl: z.union([z.literal(""), z.url().max(500)]),
  point: z.string().trim().max(400),
});

async function loadNewsletter(channelId: string, id: string) {
  const ctx = await requireChannelPermission(channelId, "publish");
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("newsletters")
    .select("*")
    .eq("channel_id", channelId)
    .eq("id", id)
    .single();
  if (!row) throw new Error("errors.not_found");
  return { ctx, admin, row };
}

/** Guarda lo editado (solo mientras es borrador). */
export async function saveNewsletter(
  channelId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const d = draftSchema.parse(input);
    const { admin, row } = await loadNewsletter(channelId, id);
    if (row.status !== "draft") return { ok: false, error: "errors.newsletter_locked" };
    const { error } = await admin
      .from("newsletters")
      .update({
        subject: d.subject,
        preheader: d.preheader,
        body: d.body,
        cta_text: d.ctaText,
        cta_url: d.ctaUrl || null,
        point: d.point,
      })
      .eq("id", id);
    if (error) throw error;
    revalidate(channelId, row.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Lo que hace falta para enviar: el correo armado, el remitente y el segmento. */
async function prepare(channelId: string, id: string, mode: "broadcast" | "test") {
  if (!EMAIL_CONFIGURED()) throw new Error("errors.email_not_configured");
  const loaded = await loadNewsletter(channelId, id);
  const { admin, row } = loaded;
  const [{ data: settings }, { data: brand }, { data: episode }] = await Promise.all([
    admin
      .from("distribution_settings")
      .select("newsletter_name, sender_name, sender_email, newsletter_segment_id")
      .eq("channel_id", channelId)
      .maybeSingle(),
    admin.from("brand_kits").select("colors").eq("channel_id", channelId).maybeSingle(),
    row.episode_id
      ? admin.from("episodes").select("title").eq("id", row.episode_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const draft: NewsletterDraft = {
    subject: row.subject,
    preheader: row.preheader,
    body: row.body,
    ctaText: row.cta_text,
    point: row.point,
  };
  const kit = parseBrandKit(brand ? { colors: brand.colors } : null);
  const name = settings?.newsletter_name || "El Punto";
  const mail = renderNewsletterEmail({
    draft,
    ctaUrl: row.cta_url,
    newsletterName: name,
    accent: kit.colors.accent,
    ink: kit.colors.canvas,
    mode,
  });
  const from = settings?.sender_email
    ? `${(settings.sender_name || name).replace(/[<>"]/g, "")} <${settings.sender_email}>`
    : emailFrom();
  // Nombre interno del envío en Resend.
  const label = `${name} · ${episode?.title ?? `semana del ${row.week_start}`}`.slice(0, 200);
  return {
    ...loaded,
    draft,
    mail,
    from,
    label,
    segmentId: settings?.newsletter_segment_id ?? null,
  };
}

/** Manda el boletín tal como saldrá, solo al correo de quien lo pide. */
export async function sendNewsletterTest(channelId: string, id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!user.email) return { ok: false, error: "errors.no_email" };
    const { admin, row, draft, mail, from } = await prepare(channelId, id, "test");
    if (!draft.subject.trim()) return { ok: false, error: "errors.newsletter_invalid" };
    await sendEmail({ to: [user.email], from, subject: `[Prueba] ${draft.subject}`, ...mail });
    await admin.from("newsletters").update({ test_sent_at: new Date().toISOString() }).eq("id", id);
    revalidate(channelId, row.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const MAX_SCHEDULE_DAYS = 30;

/** Envía ya (sin fecha) o programa el boletín al segmento del canal. */
export async function sendNewsletter(
  channelId: string,
  id: string,
  scheduledAt: string | null = null,
): Promise<ActionResult> {
  try {
    let when: Date | null = null;
    if (scheduledAt) {
      when = new Date(scheduledAt);
      const ms = when.getTime() - Date.now();
      if (Number.isNaN(ms) || ms < 5 * 60_000 || ms > MAX_SCHEDULE_DAYS * 86_400_000)
        return { ok: false, error: "errors.newsletter_schedule" };
    }
    const { ctx, admin, row, draft, mail, from, label, segmentId } = await prepare(
      channelId,
      id,
      "broadcast",
    );
    if (row.status !== "draft") return { ok: false, error: "errors.newsletter_locked" };
    if (!segmentId) return { ok: false, error: "errors.newsletter_no_segment" };
    if (validateNewsletter(draft).length) return { ok: false, error: "errors.newsletter_invalid" };

    // Se marca antes de enviar para que dos clics no lo manden dos veces.
    const { data: claimed } = await admin
      .from("newsletters")
      .update({ status: when ? "scheduled" : "sent", sent_by: ctx.userId })
      .eq("id", id)
      .eq("status", "draft")
      .select("id");
    if (!claimed?.length) return { ok: false, error: "errors.newsletter_locked" };
    try {
      const res = await sendBroadcast({
        segmentId,
        from,
        subject: draft.subject,
        html: mail.html,
        text: mail.text,
        name: label,
        scheduledAt: when?.toISOString() ?? null,
      });
      await admin
        .from("newsletters")
        .update({
          broadcast_id: res.id,
          scheduled_at: when?.toISOString() ?? null,
          sent_at: when ? null : new Date().toISOString(),
        })
        .eq("id", id);
    } catch (err) {
      await admin.from("newsletters").update({ status: "draft", sent_by: null }).eq("id", id);
      throw err;
    }
    revalidate(channelId, row.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
