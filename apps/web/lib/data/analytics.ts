import "server-only";
import {
  retentionByParagraph,
  scriptParagraphs,
  type ParagraphRetention,
  type RetentionPoint,
} from "@planificador/core";
import { getSupabase } from "../auth";

/**
 * Analítica de canal y episodio (Fase 4 · paso 1), leída de las tablas que
 * llena el cron diario con la YouTube Analytics API.
 */

export type DayPoint = { day: string; value: number };

export type PeriodTotals = {
  views: number;
  watchMinutes: number;
  /** Duración media ponderada por vistas (segundos). */
  averageViewDurationS: number;
  /** % visto promedio, ponderado por vistas. */
  averageViewPercentage: number;
  subscribersNet: number;
  likes: number;
  comments: number;
};

type DayRow = {
  day: string;
  views: number | string | null;
  watch_minutes: number | string | null;
  average_view_duration_seconds: number | string | null;
  average_view_percentage: number | string | null;
  subscribers_gained: number | string | null;
  subscribers_lost: number | string | null;
  likes: number | string | null;
  comments: number | string | null;
};

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

/** Suma un período: lo aditivo se suma y lo promedio se pondera por vistas. */
export function totals(rows: readonly DayRow[]): PeriodTotals {
  const views = rows.reduce((a, r) => a + n(r.views), 0);
  const weighted = (key: keyof DayRow) =>
    views ? rows.reduce((a, r) => a + n(r[key]) * n(r.views), 0) / views : 0;
  return {
    views,
    watchMinutes: rows.reduce((a, r) => a + n(r.watch_minutes), 0),
    averageViewDurationS: weighted("average_view_duration_seconds"),
    averageViewPercentage: weighted("average_view_percentage"),
    subscribersNet: rows.reduce((a, r) => a + n(r.subscribers_gained) - n(r.subscribers_lost), 0),
    likes: rows.reduce((a, r) => a + n(r.likes), 0),
    comments: rows.reduce((a, r) => a + n(r.comments), 0),
  };
}

const DAY_COLUMNS =
  "day, views, watch_minutes, average_view_duration_seconds, average_view_percentage, subscribers_gained, subscribers_lost, likes, comments";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (days: number, from = new Date()) =>
  isoDay(new Date(from.getTime() - days * 86_400_000));

export type EpisodeRow = {
  episodeId: string;
  code: string;
  title: string;
  videoId: string;
  publishedAt: string;
  firstWeek: PeriodTotals;
  total: PeriodTotals;
  hasRetention: boolean;
};

export type ChannelAnalytics = {
  connected: boolean;
  fetchedAt: string | null;
  /** Últimos 28 días con datos, y los 28 anteriores para comparar. */
  current: PeriodTotals;
  previous: PeriodTotals | null;
  daily: DayPoint[];
  episodes: EpisodeRow[];
};

export const PERIOD_DAYS = 28;

export async function loadChannelAnalytics(channelId: string): Promise<ChannelAnalytics> {
  const supabase = await getSupabase();
  const [{ data: days }, { data: episodes }] = await Promise.all([
    supabase
      .from("youtube_channel_daily_stats")
      .select(`${DAY_COLUMNS}, fetched_at`)
      .eq("channel_id", channelId)
      .gte("day", daysAgo(PERIOD_DAYS * 2 + 7))
      .order("day"),
    supabase
      .from("episodes")
      .select("id, code, title, youtube_video_id, published_at")
      .eq("channel_id", channelId)
      .not("youtube_video_id", "is", null)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(30),
  ]);
  const rows = days ?? [];
  // YouTube publica con 2 o 3 días de atraso: el período termina en el último día con datos.
  const last = rows.at(-1)?.day ?? null;
  const end = last ? new Date(`${last}T00:00:00Z`) : new Date();
  const curFrom = daysAgo(PERIOD_DAYS - 1, end);
  const prevFrom = daysAgo(PERIOD_DAYS * 2 - 1, end);
  const current = rows.filter((r) => r.day >= curFrom);
  const previous = rows.filter((r) => r.day >= prevFrom && r.day < curFrom);

  const ids = (episodes ?? []).map((e) => e.youtube_video_id!) as string[];
  const [{ data: videoDays }, { data: retention }] = ids.length
    ? await Promise.all([
        supabase
          .from("youtube_video_daily_stats")
          .select(`video_id, ${DAY_COLUMNS}`)
          .eq("channel_id", channelId)
          .in("video_id", ids),
        supabase
          .from("youtube_video_retention")
          .select("video_id")
          .eq("channel_id", channelId)
          .in("video_id", ids),
      ])
    : [{ data: [] }, { data: [] }];

  const withRetention = new Set((retention ?? []).map((r) => r.video_id));
  const episodeRows = (episodes ?? []).flatMap((e): EpisodeRow[] => {
    const vDays = (videoDays ?? []).filter((d) => d.video_id === e.youtube_video_id);
    if (!vDays.length) return [];
    const published = e.published_at!.slice(0, 10);
    const weekEnd = isoDay(new Date(new Date(`${published}T00:00:00Z`).getTime() + 6 * 86_400_000));
    return [
      {
        episodeId: e.id,
        code: e.code,
        title: e.title,
        videoId: e.youtube_video_id!,
        publishedAt: e.published_at!,
        firstWeek: totals(vDays.filter((d) => d.day <= weekEnd)),
        total: totals(vDays),
        hasRetention: withRetention.has(e.youtube_video_id!),
      },
    ];
  });

  return {
    connected: rows.length > 0,
    fetchedAt: rows.reduce<string | null>(
      (a, r) => (!a || r.fetched_at > a ? r.fetched_at : a),
      null,
    ),
    current: totals(current),
    previous: previous.length >= PERIOD_DAYS / 2 ? totals(previous) : null,
    daily: current.map((r) => ({ day: r.day, value: n(r.views) })),
    episodes: episodeRows,
  };
}

export type EpisodeMetrics = {
  totals: PeriodTotals | null;
  daily: DayPoint[];
  retention: RetentionPoint[];
  paragraphs: ParagraphRetention[];
  /** De qué texto salen los párrafos. */
  scriptSource: "fix" | "revision" | "teleprompter" | null;
  fetchedAt: string | null;
};

/** El guion grabado: el verificado, o si no la revisión o el teleprompter. */
const SCRIPT_STEPS = ["fix", "revision", "teleprompter"] as const;

export async function loadEpisodeMetrics(episode: {
  channelId: string;
  videoId: string;
  currentScriptRunId: string | null;
}): Promise<EpisodeMetrics> {
  const supabase = await getSupabase();
  const [{ data: days }, { data: retention }, { data: steps }] = await Promise.all([
    supabase
      .from("youtube_video_daily_stats")
      .select(`${DAY_COLUMNS}, fetched_at`)
      .eq("channel_id", episode.channelId)
      .eq("video_id", episode.videoId)
      .order("day"),
    supabase
      .from("youtube_video_retention")
      .select("points, fetched_at")
      .eq("channel_id", episode.channelId)
      .eq("video_id", episode.videoId)
      .maybeSingle(),
    episode.currentScriptRunId
      ? supabase
          .from("script_step_runs")
          .select("step, body")
          .eq("run_id", episode.currentScriptRunId)
          .eq("status", "succeeded")
          .in("step", [...SCRIPT_STEPS])
      : Promise.resolve({ data: [] as { step: string; body: string | null }[] }),
  ]);
  const source = SCRIPT_STEPS.find((s) => steps?.some((x) => x.step === s && x.body)) ?? null;
  const script = source ? (steps?.find((x) => x.step === source)?.body ?? "") : "";
  const points = ((retention?.points ?? []) as unknown as RetentionPoint[]).filter(
    (p) => Number.isFinite(p.r) && Number.isFinite(p.watch),
  );
  return {
    totals: days?.length ? totals(days) : null,
    daily: (days ?? []).map((d) => ({ day: d.day, value: n(d.views) })),
    retention: points,
    paragraphs: retentionByParagraph(points, scriptParagraphs(script)),
    scriptSource: source,
    fetchedAt: retention?.fetched_at ?? days?.at(-1)?.fetched_at ?? null,
  };
}
