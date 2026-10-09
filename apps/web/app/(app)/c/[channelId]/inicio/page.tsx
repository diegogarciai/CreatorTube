import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { CalendarCheck, Lightbulb, Package } from "lucide-react";
import {
  gearLabel,
  IDEAS_LOW_BANK,
  LOAN_WARN_DAYS,
  loanDaysLeft,
  localDateKey,
  type GearOwnership,
  type GearStatus,
} from "@planificador/core";
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
import { getChannelContext, getSupabase } from "@/lib/auth";
import { toPlannedEpisode } from "@/lib/data/episodes";
import { getEpisodes, getPillars } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Inicio" };

export default async function HomePage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("home");
  const supabase = await getSupabase();
  const [rows, pillars, { count: newIdeas }, { data: loans }] = await Promise.all([
    getEpisodes(channelId),
    getPillars(channelId),
    supabase
      .from("ideas")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId)
      .eq("status", "new"),
    supabase
      .from("gear")
      .select("id, name, brand, model, ownership, return_by, status")
      .eq("channel_id", channelId)
      .eq("ownership", "loan")
      .eq("status", "active")
      .not("return_by", "is", null),
  ]);
  const lowBank = ctx.can("write_script") && (newIdeas ?? 0) < IDEAS_LOW_BANK;
  const tz = ctx.channel.timezone;
  const now = new Date();
  const todayKey = localDateKey(now, tz);
  // Préstamos de marcas por devolver pronto (o vencidos).
  const dueLoans = (loans ?? [])
    .map((g) => ({
      id: g.id,
      label: gearLabel(g),
      days: loanDaysLeft(
        {
          ownership: g.ownership as GearOwnership,
          return_by: g.return_by,
          status: g.status as GearStatus,
        },
        todayKey,
      ),
    }))
    .filter(
      (g): g is { id: string; label: string; days: number } =>
        g.days !== null && g.days <= LOAN_WARN_DAYS,
    )
    .sort((a, b) => a.days - b.days);
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
      {lowBank ? (
        <Link
          href={`/c/${channelId}/ideas`}
          className="mb-6 flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm hover:underline"
          data-testid="home-low-bank"
        >
          <Lightbulb className="size-4 text-accent" />
          {t("lowBank", { count: newIdeas ?? 0 })}
        </Link>
      ) : null}
      {dueLoans.map((g) => (
        <Link
          key={g.id}
          href={`/c/${channelId}/equipo`}
          className="mb-3 flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn hover:underline"
          data-testid="home-loan"
        >
          <Package className="size-4" />
          {g.days < 0
            ? t("loanLate", { name: g.label, days: -g.days })
            : t("loanDue", { name: g.label, days: g.days })}
        </Link>
      ))}
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
