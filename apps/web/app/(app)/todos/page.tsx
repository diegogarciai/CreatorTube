import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { localDateKey } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { computeOverview } from "@/components/home/overview";
import { getMyChannels, getMyMemberships, getSupabase } from "@/lib/auth";
import { toPlannedEpisode } from "@/lib/data/episodes";
import { formatDateKey } from "@/lib/utils";

export const metadata: Metadata = { title: "Todos mis canales" };

/** Vista para quien maneja varios canales. No compara canales de distintos dueños: agrupa por espacio. */
export default async function AllChannelsPage() {
  const t = await getTranslations();
  const [channels, memberships] = await Promise.all([getMyChannels(), getMyMemberships()]);
  const supabase = await getSupabase();
  const { data: rows } = channels.length
    ? await supabase.from("episodes").select("*").in("channel_id", channels.map((c) => c.id)).is("archived_at", null)
    : { data: [] };
  const now = new Date();

  return (
    <Page>
      <PageHeader title={t("allChannels.title")} description={t("allChannels.subtitle")} />
      <div className="space-y-8">
        {memberships.map((m) => {
          const wsChannels = channels.filter((c) => c.workspace_id === m.workspaceId);
          if (wsChannels.length === 0) return null;
          return (
            <section key={m.workspaceId}>
              {memberships.length > 1 ? (
                <h2 className="mb-3 text-sm font-semibold text-muted">{t("allChannels.workspaceGroup", { name: m.workspaceName })}</h2>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                {wsChannels.map((c) => {
                  const eps = (rows ?? []).filter((r) => r.channel_id === c.id).map((r) => toPlannedEpisode(r, c.timezone));
                  const o = computeOverview({ channelId: c.id, weeklyGoal: c.weekly_goal, episodes: eps, today: localDateKey(now, c.timezone), now });
                  const critical = o.alerts.filter((a) => a.severity === "critical").length;
                  return (
                    <Card key={c.id}>
                      <CardBody>
                        <div className="flex items-start justify-between gap-3">
                          <Link href={`/c/${c.id}/inicio`} className="font-semibold hover:underline">
                            {c.name}
                          </Link>
                          <Badge tone={o.coverage.missing === 0 ? "ok" : "warn"}>
                            {t("home.weekGoal")}: {o.coverage.planned}/{o.coverage.goal}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {t("home.streakValue", { weeks: o.streak })}
                          {critical ? ` · ${critical} ${t("signals.critical").toLowerCase()}` : ""}
                        </p>
                        <ul className="mt-3 space-y-1 text-sm">
                          {o.alerts.slice(0, 3).map((a, i) => (
                            <li key={i} className={a.severity === "critical" ? "text-critical" : a.severity === "warning" ? "text-warn" : "text-muted"}>
                              {t(`alerts.${a.kind}`, {
                                ...a.params,
                                ...(typeof a.params.weekStart === "string" && { weekStart: formatDateKey(a.params.weekStart) }),
                              })}
                            </li>
                          ))}
                        </ul>
                        {o.upcoming.length ? (
                          <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                            {o.upcoming.slice(0, 4).map((u) => (
                              <li key={`${u.episodeId}-${u.kind}`} className="flex gap-2">
                                <span className="w-16 shrink-0 text-muted">{formatDateKey(u.date, { weekday: "short", day: "numeric" })}</span>
                                <span className="text-muted">{u.kind === "publish" ? "▶" : "●"}</span>
                                <Link href={`/c/${c.id}/episodios/${u.episodeId}`} className="truncate hover:underline">
                                  {u.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
