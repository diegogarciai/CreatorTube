"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBrandKit, validateNewsletter, type NewsletterDraft } from "@planificador/core";
import { getSupabase, requireChannelPermission, requireUser } from "../auth";
import { EMAIL_CONFIGURED, emailFrom, sendBroadcast, sendEmail } from "../email";
import { startJob } from "../jobs";
import { renderNewsletterEmail } from "../newsletter-email";
import { createAdminClient } from "../supabase/admin";
import { NEWSLETTER_ESTIMATE_CREDITS } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Boletín semanal (Fase 4 · paso 5): Claude lo redacta a pedido; quien tiene
 * permiso de publicar lo edita, se manda una prueba y lo envía o lo programa
 * con Resend Broadcasts al segmento del canal.
 */

const revalidate = (channelId: string) => revalidatePath(`/c/${channelId}/boletin`);

/** Redacta (o rehace) el borrador de esta semana con los episodios publicados. */
export async function draftNewsletter(channelId: string): Promise<ActionResult> {
  try {
    const ctx = await requireChannelPermission(channelId, "publish");
    const admin = createAdminClient();
    const { count: running } = await admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId)
      .eq("kind", "newsletter")
      .in("status", ["queued", "running"]);
    if (running) return { ok: false, error: "errors.busy" };
    const supabase = await getSupabase();
    const { data: credits } = await supabase.rpc("workspace_credits", {
      ws: ctx.channel.workspace_id,
    });
    if (Number(credits?.[0]?.remaining ?? 0) < NEWSLETTER_ESTIMATE_CREDITS)
      return { ok: false, error: "errors.no_credits" };
    await startJob("newsletter", {
      workspaceId: ctx.channel.workspace_id,
      channelId,
      requestedBy: ctx.userId,
    });
    revalidate(channelId);
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
    revalidate(channelId);
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
  const [{ data: settings }, { data: brand }] = await Promise.all([
    admin
      .from("distribution_settings")
      .select("newsletter_name, sender_name, sender_email, newsletter_segment_id")
      .eq("channel_id", channelId)
      .maybeSingle(),
    admin.from("brand_kits").select("colors").eq("channel_id", channelId).maybeSingle(),
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
  return { ...loaded, draft, mail, from, name, segmentId: settings?.newsletter_segment_id ?? null };
}

/** Manda el boletín tal como saldrá, solo al correo de quien lo pide. */
export async function sendNewsletterTest(channelId: string, id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!user.email) return { ok: false, error: "errors.no_email" };
    const { admin, draft, mail, from } = await prepare(channelId, id, "test");
    if (!draft.subject.trim()) return { ok: false, error: "errors.newsletter_invalid" };
    await sendEmail({ to: [user.email], from, subject: `[Prueba] ${draft.subject}`, ...mail });
    await admin.from("newsletters").update({ test_sent_at: new Date().toISOString() }).eq("id", id);
    revalidate(channelId);
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
    const { ctx, admin, row, draft, mail, from, name, segmentId } = await prepare(
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
        name: `${name} · ${row.week_start}`,
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
    revalidate(channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
