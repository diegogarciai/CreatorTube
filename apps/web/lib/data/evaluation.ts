import "server-only";
import {
  BASELINE_EPISODES,
  compareToBaseline,
  evaluationWindow,
  firstWeekReady,
  monthRange,
  type AuditProposals,
  type EvaluationData,
  type MetricValues,
} from "@planificador/core";
import type { AuditInput } from "@planificador/ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@planificador/db";
import { getSupabase } from "../auth";
import { loadEpisodeMetrics, totals } from "./analytics";

/**
 * Evaluación a 7 días y auditoría mensual (Fase 4 · paso 3). Los números los
 * calcula la app (se marcan «calculado por la app»): la primera semana del
 * episodio contra la mediana de la primera semana de los anteriores.
 */

type Db = SupabaseClient<Database>;

const DAY_COLUMNS =
  "video_id, day, views, watch_minutes, average_view_duration_seconds, average_view_percentage, subscribers_gained, subscribers_lost, likes, comments";

type FirstWeek = {
  episodeId: string;
  code: string;
  publishedAt: string;
  ready: boolean;
  values: MetricValues;
};

/** La primera semana de los episodios publicados del canal (los más recientes primero). */
async function firstWeeks(db: Db, channelId: string): Promise<FirstWeek[]> {
  const { data: episodes } = await db
    .from("episodes")
    .select("id, code, youtube_video_id, published_at")
    .eq("channel_id", channelId)
    .not("youtube_video_id", "is", null)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(40);
  const eps = episodes ?? [];
  const ids = eps.map((e) => e.youtube_video_id!);
  if (!ids.length) return [];
  const [{ data: days }, { data: reach }] = await Promise.all([
    db
      .from("youtube_video_daily_stats")
      .select(DAY_COLUMNS)
      .eq("channel_id", channelId)
      .in("video_id", ids)
      .order("day"),
    db.rpc("reach_by_video", { p_channel: channelId, p_videos: ids }),
  ]);
  return eps.map((e) => {
    const w = evaluationWindow(e.published_at!);
    const vDays = (days ?? []).filter((d) => d.video_id === e.youtube_video_id);
    const week = vDays.filter((d) => d.day >= w.from && d.day <= w.to);
    const t = totals(week);
    const r = (reach ?? []).find((x) => x.video_id === e.youtube_video_id);
    const impressions = r ? Number(r.week_impressions) || 0 : null;
    const clicks = r ? Number(r.week_clicks) || 0 : null;
    return {
      episodeId: e.id,
      code: e.code,
      publishedAt: e.published_at!,
      ready: firstWeekReady(e.published_at!, vDays.at(-1)?.day ?? null),
      values: {
        views: t.views,
        averageViewPercentage: t.views ? t.averageViewPercentage : null,
        averageViewDurationS: t.views ? t.averageViewDurationS : null,
        impressions: impressions || null,
        ctr: impressions ? clicks! / impressions : null,
        likes: t.likes,
        comments: t.comments,
        subscribersNet: t.subscribersNet,
      },
    };
  });
}

/**
 * Los números de la evaluación de un episodio, o `ready: false` si todavía
 * no llegaron los 7 días de datos.
 */
export async function buildEvaluation(
  db: Db,
  episode: {
    id: string;
    channelId: string;
    videoId: string;
    publishedAt: string;
    currentScriptRunId: string | null;
  },
): Promise<{ ready: false } | { ready: true; data: EvaluationData }> {
  const weeks = await firstWeeks(db, episode.channelId);
  const me = weeks.find((w) => w.episodeId === episode.id);
  if (!me?.ready) return { ready: false };
  const baseline = weeks
    .filter((w) => w.ready && w.episodeId !== episode.id && w.publishedAt < episode.publishedAt)
    .slice(0, BASELINE_EPISODES);
  const metrics = await loadEpisodeMetrics({
    channelId: episode.channelId,
    videoId: episode.videoId,
    currentScriptRunId: episode.currentScriptRunId,
  });
  return {
    ready: true,
    data: {
      window: evaluationWindow(episode.publishedAt),
      metrics: compareToBaseline(
        me.values,
        baseline.map((b) => b.values),
      ),
      baseline: { count: baseline.length, codes: baseline.map((b) => b.code) },
      drops: metrics.paragraphs
        .filter((p) => p.top)
        .sort((a, b) => b.drop - a.drop)
        .map((p) => ({
          index: p.index,
          text: p.text.length > 220 ? `${p.text.slice(0, 220)}…` : p.text,
          drop: p.drop,
        })),
      verdict: null,
      summary: "",
      learnings: [],
    },
  };
}

export type EpisodeEvaluationView = {
  status: "none" | "pending" | "done" | "failed";
  data: EvaluationData | null;
  /** La tarea está en marcha. */
  active: boolean;
  error: string | null;
  /** Los 7 días de datos ya llegaron (sin evaluación todavía). */
  ready: boolean;
  /** Desde qué día se puede evaluar (el séptimo día, más el atraso de YouTube). */
  window: { from: string; to: string };
};

export async function loadEpisodeEvaluation(episode: {
  id: string;
  channelId: string;
  videoId: string;
  publishedAt: string;
}): Promise<EpisodeEvaluationView> {
  const supabase = await getSupabase();
  const [{ data: row }, { data: task }, { data: last }] = await Promise.all([
    supabase
      .from("episode_evaluations")
      .select("status, data")
      .eq("episode_id", episode.id)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("episode_id", episode.id)
      .eq("kind", "evaluation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("youtube_video_daily_stats")
      .select("day")
      .eq("channel_id", episode.channelId)
      .eq("video_id", episode.videoId)
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const active = task?.status === "queued" || task?.status === "running";
  return {
    status: (row?.status as EpisodeEvaluationView["status"] | undefined) ?? "none",
    data: (row?.data as unknown as EvaluationData | null) ?? null,
    active,
    error: task?.status === "failed" ? (task.error ?? "errors.unknown") : null,
    ready: firstWeekReady(episode.publishedAt, last?.day ?? null),
    window: evaluationWindow(episode.publishedAt),
  };
}

/** Las evaluaciones hechas de los episodios publicados en un mes («AAAA-MM»). */
export async function auditInput(
  db: Db,
  channelId: string,
  month: string,
): Promise<Pick<AuditInput, "evaluations">> {
  const { from, to } = monthRange(month);
  const { data: rows } = await db
    .from("episode_evaluations")
    .select("verdict, data, episode:episodes(code, title, published_at, pillar:pillars(name))")
    .eq("channel_id", channelId)
    .eq("status", "done");
  const evaluations = (rows ?? [])
    .map((r) => ({ r, data: r.data as unknown as EvaluationData }))
    .filter(({ data }) => data.window?.from >= from && data.window.from <= to)
    .sort((a, b) => a.data.window.from.localeCompare(b.data.window.from))
    .map(({ r, data }) => ({
      code: r.episode?.code ?? "",
      title: r.episode?.title ?? "",
      publishedOn: data.window.from,
      pillar: r.episode?.pillar?.name ?? null,
      verdict: data.verdict,
      summary: data.summary,
      learnings: data.learnings,
      metrics: data.metrics,
      drops: data.drops.map((d) => d.text),
    }));
  return { evaluations };
}

export type AuditView = {
  /** Meses («AAAA-MM») con evaluaciones hechas, del más reciente al más viejo. */
  months: { month: string; evaluations: number }[];
  audits: {
    id: string;
    month: string;
    status: "pending" | "done" | "failed";
    evaluations: number;
    proposals: AuditProposals | null;
    updatedAt: string;
  }[];
  active: boolean;
  error: string | null;
};

export async function loadAudits(channelId: string): Promise<AuditView> {
  const supabase = await getSupabase();
  const [{ data: evals }, { data: audits }, { data: task }] = await Promise.all([
    supabase
      .from("episode_evaluations")
      .select("data")
      .eq("channel_id", channelId)
      .eq("status", "done"),
    supabase
      .from("channel_audits")
      .select("id, month, status, evaluations, proposals, updated_at")
      .eq("channel_id", channelId)
      .order("month", { ascending: false })
      .limit(12),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("channel_id", channelId)
      .eq("kind", "audit")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const counts = new Map<string, number>();
  for (const e of evals ?? []) {
    const from = (e.data as unknown as EvaluationData).window?.from;
    if (from) counts.set(from.slice(0, 7), (counts.get(from.slice(0, 7)) ?? 0) + 1);
  }
  return {
    months: [...counts.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, evaluations]) => ({ month, evaluations })),
    audits: (audits ?? []).map((a) => ({
      id: a.id,
      month: a.month.slice(0, 7),
      status: a.status as AuditView["audits"][number]["status"],
      evaluations: a.evaluations,
      proposals: a.status === "done" ? (a.proposals as unknown as AuditProposals) : null,
      updatedAt: a.updated_at,
    })),
    active: task?.status === "queued" || task?.status === "running",
    error: task?.status === "failed" ? (task.error ?? "errors.unknown") : null,
  };
}
