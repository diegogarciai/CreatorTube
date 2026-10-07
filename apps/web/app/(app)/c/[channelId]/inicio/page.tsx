import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CalendarCheck } from "lucide-react";
import { localDateKey } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NewEpisodeButton } from "@/components/episodes/new-episode-button";
import {
  AlertsCard,
  computeOverview,
  SignalsCard,
  StatTiles,
  UpcomingCard,
} from "@/components/home/overview";
import { getChannelContext } from "@/lib/auth";
import { toPlannedEpisode } from "@/lib/data/episodes";
import { getEpisodes, getPillars } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Inicio" };

export default async function HomePage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("home");
  const [rows, pillars] = await Promise.all([getEpisodes(channelId), getPillars(channelId)]);
  const tz = ctx.channel.timezone;
  const now = new Date();
  const episodes = rows.map((r) => toPlannedEpisode(r, tz));
  const overview = computeOverview({
    channelId,
    weeklyGoal: ctx.channel.weekly_goal,
    episodes,
    today: localDateKey(now, tz),
    now,
  });
  const newButton = (autoOpen: boolean) =>
    ctx.can("manage_episodes") ? (
      <NewEpisodeButton
        autoOpen={autoOpen}
        channelId={channelId}
        pillars={pillars.map((p) => ({ id: p.id, name: p.name }))}
      />
    ) : null;

  return (
    <Page>
      <PageHeader title={t("title")} description={ctx.channel.name} actions={newButton(true)} />
      {episodes.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="size-8" />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
          action={newButton(false)}
        />
      ) : (
        <div className="space-y-6">
          <StatTiles overview={overview} />
          <div className="grid gap-6 lg:grid-cols-2">
            <AlertsCard alerts={overview.alerts} channelId={channelId} />
            <UpcomingCard upcoming={overview.upcoming} channelId={channelId} />
          </div>
          <SignalsCard signals={overview.signals} />
        </div>
      )}
    </Page>
  );
}
