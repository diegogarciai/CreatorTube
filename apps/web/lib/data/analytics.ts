import "server-only";
import {
  retentionByParagraph,
  scriptParagraphs,
  type ParagraphRetention,
  type RetentionPoint,
} from "@planificador/core";
import { getSupabase } from "../auth";
import { reachTotals, sourceRows, type ReachTotals, type SourceRow } from "../reach";
import {
  daySummary,
  lastCompleteDay,
  typicalDay,
  TYPICAL_WINDOW,
  yesterdayFromSnapshots,
  type ChannelDay,
  type DaySummary,
  type TypicalDay,
  type YesterdayReport,
} from "../daily-report";

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

/** El alcance de un período del canal y el anterior, y de dónde vinieron las impresiones. */
export type ChannelReach = {
  current: ReachTotals;
  previous: ReachTotals | null;
  /** Último día con datos (YouTube los publica con hasta 48 h de atraso). */
  lastDay: string;
  sources: SourceRow[];
};

export type EpisodeRow = {
  episodeId: string;
  code: string;
  title: string;
  videoId: string;
  publishedAt: string;
  firstWeek: PeriodTotals;
  total: PeriodTotals;
  hasRetention: boolean;
  reach: { firstWeek: ReachTotals; total: ReachTotals } | null;
};

export type ChannelAnalytics = {
  connected: boolean;
  fetchedAt: string | null;
  /** Últimos 28 días con datos, y los 28 anteriores para comparar. */
  current: PeriodTotals;
  previous: PeriodTotals | null;
  daily: DayPoint[];
  episodes: EpisodeRow[];
  /** null mientras no llegue ningún reporte de alcance. */
  reach: ChannelReach | null;
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
  const [reach, { data: videoReach }] = await Promise.all([
    loadChannelReach(channelId),
    ids.length
      ? supabase.rpc("reach_by_video", { p_channel: channelId, p_videos: ids })
      : Promise.resolve({ data: [] }),
  ]);
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
        reach: (() => {
          const r = (videoReach ?? []).find((x) => x.video_id === e.youtube_video_id);
          return r
            ? {
                firstWeek: reachTotals([
                  { impressions: r.week_impressions, clicks: r.week_clicks },
                ]),
                total: reachTotals([r]),
              }
            : null;
        })(),
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
    reach,
  };
}

/** El alcance del canal: los últimos 28 días con datos, los 28 anteriores y las fuentes. */
async function loadChannelReach(channelId: string): Promise<ChannelReach | null> {
  const supabase = await getSupabase();
  const { data: days } = await supabase.rpc("reach_by_day", {
    p_channel: channelId,
    p_from: daysAgo(PERIOD_DAYS * 2 + 7),
  });
  const rows = days ?? [];
  const last = rows.at(-1)?.day;
  if (!last) return null;
  const end = new Date(`${last}T00:00:00Z`);
  const curFrom = daysAgo(PERIOD_DAYS - 1, end);
  const prevFrom = daysAgo(PERIOD_DAYS * 2 - 1, end);
  const previous = rows.filter((r) => r.day >= prevFrom && r.day < curFrom);
  const { data: sources } = await supabase.rpc("reach_by_source", {
    p_channel: channelId,
    p_from: curFrom,
    p_to: last,
  });
  return {
    current: reachTotals(rows.filter((r) => r.day >= curFrom)),
    previous: previous.length >= PERIOD_DAYS / 2 ? reachTotals(previous) : null,
    lastDay: last,
    sources: sourceRows(sources ?? []),
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
  /** Impresiones y CTR desde la publicación, y de dónde vinieron (null sin reportes). */
  reach: { total: ReachTotals; sources: SourceRow[] } | null;
};

/** El guion grabado: el verificado, o si no la revisión o el teleprompter. */
const SCRIPT_STEPS = ["fix", "revision", "teleprompter"] as const;

export async function loadEpisodeMetrics(episode: {
  channelId: string;
  videoId: string;
  currentScriptRunId: string | null;
}): Promise<EpisodeMetrics> {
  const supabase = await getSupabase();
  const [
    { data: days },
    { data: retention },
    { data: steps },
    { data: vReach },
    { data: vSources },
  ] = await Promise.all([
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
    supabase.rpc("reach_by_video", { p_channel: episode.channelId, p_videos: [episode.videoId] }),
    supabase.rpc("reach_by_source", {
      p_channel: episode.channelId,
      p_from: "2005-01-01",
      p_to: isoDay(new Date()),
      p_video: episode.videoId,
    }),
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
    reach: vReach?.length
      ? { total: reachTotals(vReach), sources: sourceRows(vSources ?? []) }
      : null,
  };
}

export type YesterdayView = {
  report: YesterdayReport | null;
  summary: DaySummary | null;
  typical: TypicalDay | null;
  lastDay: ChannelDay | null;
  /** Título, miniatura y episodio de los videos que aparecen en el panel. */
  videos: Record<string, { title: string; thumbnailUrl: string | null; episodeId: string | null }>;
  /** Hay alguna foto (para el aviso «aparecen mañana»). */
  hasSnapshots: boolean;
};

/** «Así te fue ayer»: las dos fotos más recientes y el día típico del canal. */
export async function loadYesterday(channelId: string): Promise<YesterdayView> {
  const supabase = await getSupabase();
  const [{ data: snaps }, { data: days }] = await Promise.all([
    supabase
      .from("youtube_video_snapshots")
      .select("video_id, day, view_count, like_count, comment_count, taken_at")
      .eq("channel_id", channelId)
      .gte("day", daysAgo(4))
      .order("day", { ascending: false })
      .limit(500),
    supabase
      .from("youtube_channel_daily_stats")
      .select(DAY_COLUMNS)
      .eq("channel_id", channelId)
      .gte("day", daysAgo(TYPICAL_WINDOW + 7))
      .order("day"),
  ]);
  const report = yesterdayFromSnapshots(
    (snaps ?? []).map((s) => ({
      videoId: s.video_id,
      day: s.day,
      views: s.view_count,
      likes: s.like_count,
      comments: s.comment_count,
      takenAt: s.taken_at,
    })),
  );
  const channelDays: ChannelDay[] = (days ?? []).map((d) => {
    const t = totals([d]);
    return {
      day: d.day,
      views: t.views,
      watchMinutes: t.watchMinutes,
      averageViewDurationS: t.averageViewDurationS,
      subscribersNet: t.subscribersNet,
      likes: t.likes,
      comments: t.comments,
    };
  });
  const typical = typicalDay(channelDays);
  const summary = report ? daySummary(report, typical) : null;
  const ids = [report?.top?.videoId].filter(Boolean) as string[];
  const [{ data: vids }, { data: eps }] = ids.length
    ? await Promise.all([
        supabase
          .from("youtube_videos")
          .select("video_id, title, thumbnail_url")
          .eq("channel_id", channelId)
          .in("video_id", ids),
        supabase
          .from("episodes")
          .select("id, youtube_video_id")
          .eq("channel_id", channelId)
          .in("youtube_video_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  return {
    report,
    summary,
    typical,
    lastDay: lastCompleteDay(channelDays),
    videos: Object.fromEntries(
      (vids ?? []).map((v) => [
        v.video_id,
        {
          title: v.title ?? v.video_id,
          thumbnailUrl: v.thumbnail_url,
          episodeId: eps?.find((e) => e.youtube_video_id === v.video_id)?.id ?? null,
        },
      ]),
    ),
    hasSnapshots: Boolean(snaps?.length),
  };
}
