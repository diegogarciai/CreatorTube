import "server-only";
import { digestHasContent, isoWeekday, localDateKey, weeklyDigest } from "@planificador/core";
import type { createAdminClient } from "./supabase/admin";
import { toPlannedEpisode } from "./data/episodes";
import { renderDigestEmail } from "./digest-email";
import { EMAIL_CONFIGURED, sendEmail } from "./email";
import { env } from "./env";
import { errorMessage } from "./utils";

type Admin = ReturnType<typeof createAdminClient>;

export interface DigestResult {
  channel: string;
  sent: number;
  skipped?: "no_content" | "no_recipients" | "already_sent";
  error?: string;
}

/**
 * Resumen semanal (Fase 4 · paso 5): el lunes (hora del canal), un correo a
 * los propietarios del espacio con acceso al canal. Uno por canal y semana
 * (weekly_digests); si el envío falla, se libera para reintentar mañana.
 * `force` lo manda aunque no sea lunes (pruebas y envío a mano).
 */
export async function sendWeeklyDigests(
  admin: Admin,
  now: Date,
  { force = false }: { force?: boolean } = {},
): Promise<DigestResult[] | { skipped: "no_email_key" }> {
  if (!EMAIL_CONFIGURED()) return { skipped: "no_email_key" };
  const { data: channels, error } = await admin
    .from("channels")
    .select("id, name, timezone, weekly_goal, workspace_id");
  if (error) throw error;
  const out: DigestResult[] = [];
  for (const ch of channels ?? []) {
    const today = localDateKey(now, ch.timezone);
    if (!force && isoWeekday(today) !== 1) continue;
    try {
      const r = await digestForChannel(admin, ch, today, now);
      if (r) out.push(r);
    } catch (err) {
      out.push({ channel: ch.id, sent: 0, error: errorMessage(err) });
    }
  }
  return out;
}

async function digestForChannel(
  admin: Admin,
  ch: { id: string; name: string; timezone: string; weekly_goal: number; workspace_id: string },
  today: string,
  now: Date,
): Promise<DigestResult | null> {
  const [{ data: rows, error }, { data: owners }, { count: newIdeas }] = await Promise.all([
    admin.from("episodes").select("*").eq("channel_id", ch.id).is("archived_at", null),
    admin
      .from("memberships")
      .select("channel_ids, profile:profiles(email)")
      .eq("workspace_id", ch.workspace_id)
      .eq("role", "owner"),
    admin
      .from("ideas")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", ch.id)
      .eq("status", "new"),
  ]);
  if (error) throw error;
  const digest = weeklyDigest(
    (rows ?? []).map((r) => toPlannedEpisode(r, ch.timezone)),
    today,
    ch.weekly_goal,
    now,
  );
  if (!digestHasContent(digest)) return { channel: ch.id, sent: 0, skipped: "no_content" };
  const to = [
    ...new Set(
      (owners ?? [])
        .filter((m) => !m.channel_ids || m.channel_ids.includes(ch.id))
        .flatMap((m) => (m.profile?.email ? [m.profile.email] : [])),
    ),
  ];
  if (!to.length) return { channel: ch.id, sent: 0, skipped: "no_recipients" };

  // Se reserva la semana antes de enviar para no mandarlo dos veces.
  const { error: claimError } = await admin
    .from("weekly_digests")
    .insert({ channel_id: ch.id, week_start: digest.weekStart, recipients: to.length });
  if (claimError) {
    if (claimError.code === "23505") return { channel: ch.id, sent: 0, skipped: "already_sent" };
    throw claimError;
  }
  try {
    const mail = renderDigestEmail({
      digest,
      channelId: ch.id,
      channelName: ch.name,
      newIdeas: newIdeas ?? 0,
      appUrl: env.appUrl,
    });
    // Un correo por persona: nadie ve el correo de otro.
    for (const email of to) await sendEmail({ to: [email], ...mail });
  } catch (err) {
    await admin
      .from("weekly_digests")
      .delete()
      .eq("channel_id", ch.id)
      .eq("week_start", digest.weekStart);
    throw err;
  }
  return { channel: ch.id, sent: to.length };
}
