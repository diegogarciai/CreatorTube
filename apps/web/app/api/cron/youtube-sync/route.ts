import { NextResponse, type NextRequest } from "next/server";
import { addDays, localDateKey } from "@planificador/core";
import { shouldSync } from "@planificador/youtube";
import { isAuthorizedCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWeeklyDigests } from "@/lib/weekly-digest";
import { syncChannelById } from "@/lib/youtube";
import { syncAnalyticsById, syncReachById } from "@/lib/youtube-analytics";
import { syncCompetitorsById } from "@/lib/youtube-competitors";

export const maxDuration = 300;

/** Margen bajo la cuota diaria de 10.000 unidades compartida por todos los canales. */
const DAILY_QUOTA_BUDGET = 9_000;

/**
 * Sincronización diaria (Vercel Cron; el plan Hobby solo permite una corrida al
 * día, a las 11:05 UTC = 6:05 en Bogotá). Con Vercel Pro puede volver a ser
 * horaria cambiando `apps/web/vercel.json`. En la Fase 2 pasa al motor de tareas;
 * la lógica vive en @planificador/youtube para moverla sin reescribirla.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) return new NextResponse("No autorizado", { status: 401 });
  const admin = createAdminClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const { data: conns, error } = await admin
    .from("channel_connections")
    .select(
      "channel_id, last_synced_at, quota_day, quota_used, channel:channels(timezone, disconnected_at)",
    )
    .eq("status", "active");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let usedToday = (conns ?? []).reduce(
    (sum, c) => sum + (c.quota_day === today ? c.quota_used : 0),
    0,
  );
  const results = [];
  for (const conn of conns ?? []) {
    if (!conn.channel || conn.channel.disconnected_at) continue;
    if (usedToday >= DAILY_QUOTA_BUDGET) break;
    const tz = conn.channel.timezone;
    const localToday = localDateKey(now, tz);
    const { data: upcoming } = await admin
      .from("episodes")
      .select("publish_date, status")
      .eq("channel_id", conn.channel_id)
      .is("archived_at", null)
      .in("status", ["editing", "scheduled"])
      .lte("publish_date", addDays(localToday, 3));
    const due = shouldSync({
      lastSyncedAt: conn.last_synced_at ? new Date(conn.last_synced_at) : null,
      now,
      timezone: tz,
      upcomingPublishDates: (upcoming ?? []).flatMap((e) =>
        e.publish_date ? [e.publish_date] : [],
      ),
      hasScheduled: (upcoming ?? []).some((e) => e.status === "scheduled"),
    });
    if (!due) continue;
    const r = await syncChannelById(admin, conn.channel_id);
    if (r) {
      usedToday += r.quotaUsed;
      results.push({
        channel: r.channelId,
        ok: r.ok,
        videos: r.videos,
        advanced: r.advanced,
        error: r.error,
      });
    }
  }
  // Resumen semanal por correo (los lunes, después de mover los estados).
  // `?digest=force` lo manda aunque no sea lunes; igual sale uno por semana.
  const digests = await sendWeeklyDigests(admin, now, {
    force: request.nextUrl.searchParams.get("digest") === "force",
  }).catch((err: unknown) => ({ error: String(err) }));
  // Analítica (Fase 4): una vez al día por canal; usa la cuota de la Analytics
  // API, aparte de la de la Data API.
  const analytics = [];
  for (const conn of conns ?? []) {
    if (!conn.channel || conn.channel.disconnected_at) continue;
    const r = await syncAnalyticsById(admin, conn.channel_id);
    if (r) {
      analytics.push({
        channel: r.channelId,
        ok: r.ok,
        days: r.channelDays,
        videos: r.videos,
        retention: r.retention,
        error: r.error,
      });
    }
  }
  // Alcance (Fase 4 · paso 2): Reporting API, sin cuota. Se corta si se acaba el tiempo.
  const reach = [];
  for (const conn of conns ?? []) {
    if (!conn.channel || conn.channel.disconnected_at) continue;
    if (Date.now() - now.getTime() > (maxDuration - 60) * 1000) break;
    const r = await syncReachById(admin, conn.channel_id);
    if (r) {
      reach.push({
        channel: r.channelId,
        ok: r.ok,
        jobsCreated: r.jobsCreated,
        reports: r.reports,
        error: r.error,
      });
    }
  }
  // Competencia (banco de ideas): unas pocas unidades de la Data API por canal seguido.
  const competitors = [];
  for (const conn of conns ?? []) {
    if (!conn.channel || conn.channel.disconnected_at) continue;
    if (Date.now() - now.getTime() > (maxDuration - 30) * 1000) break;
    const r = await syncCompetitorsById(admin, conn.channel_id);
    if (r) competitors.push(r);
  }
  return NextResponse.json({
    synced: results.length,
    quotaUsedToday: usedToday,
    results,
    digests,
    analytics,
    reach,
    competitors,
  });
}
