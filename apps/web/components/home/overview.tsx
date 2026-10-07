import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock, Clapperboard, Flame, Target, TriangleAlert } from "lucide-react";
import {
  addDays,
  channelSignals,
  computeAlerts,
  publishingStreak,
  startOfWeek,
  upcomingDates,
  weekCoverage,
  type Alert,
  type PlannedEpisode,
  type Severity,
  type Signal,
} from "@planificador/core";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/episodes/status-badge";
import { formatDateKey } from "@/lib/utils";

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "critical",
  warning: "warn",
  info: "neutral",
};
const LEVEL_TONE: Record<Signal["level"], Tone> = {
  ok: "ok",
  warning: "warn",
  critical: "critical",
};

export interface OverviewInput {
  channelId: string;
  channelName?: string;
  weeklyGoal: number;
  episodes: PlannedEpisode[];
  today: string;
  now: Date;
}

export function computeOverview(input: OverviewInput) {
  const rhythm = { weeklyGoal: input.weeklyGoal };
  const week = startOfWeek(input.today);
  return {
    coverage: weekCoverage(input.episodes, week, rhythm),
    nextWeeks: [1, 2].map((i) => weekCoverage(input.episodes, addDays(week, 7 * i), rhythm)),
    streak: publishingStreak(input.episodes, input.today, rhythm),
    alerts: computeAlerts(input.episodes, input.today, rhythm, input.now),
    upcoming: upcomingDates(input.episodes, input.today),
    signals: channelSignals(input.episodes, input.today, rhythm),
  };
}

export async function StatTiles({ overview }: { overview: ReturnType<typeof computeOverview> }) {
  const t = await getTranslations("home");
  const { coverage, nextWeeks, streak } = overview;
  const pct = Math.min(100, Math.round(coverage.ratio * 100));
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Target className="size-4" /> {t("weekGoal")}
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {coverage.planned}/{coverage.goal}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className={`h-full rounded-full ${pct >= 100 ? "bg-ok" : "bg-accent"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {t("weekGoalValue", {
              planned: coverage.planned,
              goal: coverage.goal,
              published: coverage.published,
            })}
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Flame className="size-4" /> {t("streak")}
          </div>
          <p className="mt-2 text-2xl font-semibold">{t("streakValue", { weeks: streak })}</p>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm text-muted">
            <CalendarClock className="size-4" /> {t("coverage")}
          </div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {nextWeeks.map((w) => (
              <li key={w.weekStart} className="flex items-center justify-between gap-2">
                <span className="text-muted">
                  {t("coverageWeek", { date: formatDateKey(w.weekStart) })}
                </span>
                <Badge tone={w.missing === 0 ? "ok" : "warn"}>
                  {w.planned}/{w.goal}
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

export async function AlertsCard({
  alerts,
  channelId,
  compact,
}: {
  alerts: Alert[];
  channelId: string;
  compact?: boolean;
}) {
  const t = await getTranslations();
  const shown = compact ? alerts.slice(0, 5) : alerts;
  return (
    <Card>
      <CardHeader title={t("home.alerts")} />
      <CardBody className="p-0">
        {shown.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">{t("home.noAlerts")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((a, i) => {
              const params = {
                ...a.params,
                ...(typeof a.params.weekStart === "string" && {
                  weekStart: formatDateKey(a.params.weekStart),
                }),
              };
              const text = t(`alerts.${a.kind}`, params);
              return (
                <li key={i} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <TriangleAlert
                    className={`mt-0.5 size-4 shrink-0 ${a.severity === "critical" ? "text-critical" : a.severity === "warning" ? "text-warn" : "text-muted"}`}
                  />
                  {a.episodeId ? (
                    <Link
                      href={`/c/${channelId}/episodios/${a.episodeId}`}
                      className="flex-1 hover:underline"
                    >
                      {text}
                    </Link>
                  ) : (
                    <span className="flex-1">{text}</span>
                  )}
                  <Badge tone={SEVERITY_TONE[a.severity]}>
                    {t(`alerts.severity.${a.severity}`)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export async function UpcomingCard({
  upcoming,
  channelId,
}: {
  upcoming: ReturnType<typeof upcomingDates>;
  channelId: string;
}) {
  const t = await getTranslations("home");
  return (
    <Card>
      <CardHeader title={t("upcoming")} />
      <CardBody className="p-0">
        {upcoming.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">{t("noUpcoming")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.map((u) => (
              <li
                key={`${u.episodeId}-${u.kind}`}
                className="flex items-center gap-3 px-5 py-2.5 text-sm"
              >
                <span className="w-16 shrink-0 text-muted">
                  {formatDateKey(u.date, { weekday: "short", day: "numeric" })}
                </span>
                <Badge tone={u.kind === "publish" ? "accent" : "neutral"}>
                  {u.kind === "publish" ? t("publish") : t("record")}
                </Badge>
                <Link
                  href={`/c/${channelId}/episodios/${u.episodeId}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {u.title}
                </Link>
                <StatusBadge status={u.status} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export async function SignalsCard({ signals }: { signals: Signal[] }) {
  const t = await getTranslations("signals");
  const th = await getTranslations("home");
  const format = (s: Signal) => {
    if (s.value === null) return t("noData");
    if (s.kind === "week_coverage" || s.kind === "on_time_rate")
      return `${Math.round(s.value * 100)} %`;
    return String(s.value);
  };
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Clapperboard className="size-4" />
            {th("signals")}
          </span>
        }
        description={t("computedNote")}
      />
      <CardBody className="grid gap-3 sm:grid-cols-2">
        {signals.map((s) => (
          <div key={s.kind} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted">{t(s.kind)}</span>
              <Badge tone={LEVEL_TONE[s.level]}>{t(s.level)}</Badge>
            </div>
            <p className="mt-1 text-xl font-semibold">{format(s)}</p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
