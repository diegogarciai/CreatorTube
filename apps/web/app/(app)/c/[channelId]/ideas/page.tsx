import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Lightbulb, Package } from "lucide-react";
import {
  gearLabel,
  IDEAS_LOW_BANK,
  ideaScore,
  type IdeaSignals,
  type IdeaStatus,
} from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { NewEpisodeButton } from "@/components/episodes/new-episode-button";
import { IdeaRowActions, NewIdeaButton } from "@/components/ideas/idea-row-actions";
import { OutliersCard } from "@/components/ideas/outliers-card";
import { SuggestIdeasButton } from "@/components/ideas/suggest-ideas";
import { getChannelContext, getSupabase } from "@/lib/auth";
import { loadCompetitors, loadOutliers } from "@/lib/data/competitors";
import { getPillars } from "@/lib/data/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ideas" };

const FILTERS: { id: IdeaStatus; key: string }[] = [
  { id: "new", key: "filterNew" },
  { id: "suggested", key: "filterSuggested" },
  { id: "in_progress", key: "filterInProgress" },
  { id: "discarded", key: "filterDiscarded" },
];

export default async function IdeasPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ filtro?: string }>;
}) {
  const { channelId } = await params;
  const { filtro } = await searchParams;
  const filter = FILTERS.find((f) => f.id === filtro)?.id ?? "new";
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations();
  const supabase = await getSupabase();
  const [{ data: ideas }, pillars, outliers, competitors, { data: task }, { data: gear }] =
    await Promise.all([
      supabase
        .from("ideas")
        .select("*")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false }),
      getPillars(channelId),
      loadOutliers(channelId),
      loadCompetitors(channelId),
      supabase
        .from("tasks")
        .select("status, error")
        .eq("channel_id", channelId)
        .eq("kind", "idea_suggestions")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("gear").select("id, name, brand, model").eq("channel_id", channelId),
    ]);
  const gearName = new Map((gear ?? []).map((g) => [g.id, gearLabel(g)]));
  const suggesting = task?.status === "queued" || task?.status === "running";
  const all = ideas ?? [];
  const shown = all
    .filter((i) => i.status === filter)
    .map((i) => ({ ...i, score: ideaScore(i.signals as IdeaSignals) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const canWrite = ctx.can("write_script");
  const canEpisode = ctx.can("manage_episodes");
  const newCount = all.filter((i) => i.status === "new").length;
  const pillarName = (id: string | null) => pillars.find((p) => p.id === id)?.name ?? null;

  return (
    <Page>
      <PageHeader
        title={t("ideas.title")}
        description={t("ideas.subtitle")}
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <SuggestIdeasButton channelId={channelId} active={suggesting} />
              <NewIdeaButton channelId={channelId} />
            </div>
          ) : null
        }
      />
      {suggesting ? (
        <p role="status" className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {t("ideas.suggestWorking")}
        </p>
      ) : task?.status === "failed" ? (
        <p className="mb-4 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
          {t("ideas.suggestFailed")}
        </p>
      ) : newCount < IDEAS_LOW_BANK && canWrite ? (
        <p className="mb-4 rounded-lg bg-accent-soft px-3 py-2 text-sm" data-testid="low-bank">
          {t("ideas.lowBank", { count: newCount, min: IDEAS_LOW_BANK })}
        </p>
      ) : null}
      <div className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/c/${channelId}/ideas?filtro=${f.id}`}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm",
              filter === f.id ? "bg-surface-muted font-medium" : "text-muted hover:text-text",
            )}
          >
            {t(`ideas.${f.key}`)}{" "}
            <span className="text-muted">{all.filter((i) => i.status === f.id).length}</span>
          </Link>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="size-8" />}
          title={t("ideas.emptyTitle")}
          description={t("ideas.emptyDesc")}
          action={
            canWrite && (filter === "new" || filter === "suggested") ? (
              filter === "suggested" ? (
                <SuggestIdeasButton channelId={channelId} active={suggesting} variant="primary" />
              ) : (
                <NewIdeaButton channelId={channelId} />
              )
            ) : null
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {shown.map((idea) => (
            <li
              key={idea.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
              data-testid={`idea-${idea.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{idea.title}</p>
                {idea.notes ? (
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-muted">
                    {idea.notes}
                  </p>
                ) : null}
                {idea.reasons ? (
                  <p className="mt-1 text-xs">
                    <span className="font-medium">{t("ideas.reasons")}:</span> {idea.reasons}
                  </p>
                ) : null}
                {idea.risk ? (
                  <p className="mt-0.5 text-xs text-muted">
                    <span className="font-medium">{t("ideas.risk")}:</span> {idea.risk}
                  </p>
                ) : null}
                {idea.gear_ids.some((id) => gearName.has(id)) ? (
                  <p className="mt-1 flex flex-wrap items-center gap-1" data-testid="idea-gear">
                    <Package className="size-3.5 text-muted" />
                    {idea.gear_ids.flatMap((id) =>
                      gearName.has(id) ? [<Badge key={id}>{gearName.get(id)}</Badge>] : [],
                    )}
                  </p>
                ) : null}
                {pillarName(idea.pillar_id) ? (
                  <p className="mt-0.5 text-xs text-muted">
                    {t("ideas.pillar")}: {pillarName(idea.pillar_id)}
                  </p>
                ) : null}
              </div>
              <Badge
                tone={
                  idea.origin === "pain_point"
                    ? "warn"
                    : idea.origin === "recommendation"
                      ? "accent"
                      : idea.origin === "search" || idea.origin === "competitor"
                        ? "ok"
                        : "neutral"
                }
              >
                {t(`ideas.originValue.${idea.origin}`)}
              </Badge>
              <span
                className="w-16 text-right text-sm tabular-nums text-muted"
                title={t("ideas.score")}
              >
                {idea.score === null ? "—" : `${idea.score}/100`}
              </span>
              <div className="flex items-center gap-1">
                {canEpisode && idea.status !== "discarded" && idea.status !== "suggested" ? (
                  <NewEpisodeButton
                    channelId={channelId}
                    pillars={pillars.map((p) => ({ id: p.id, name: p.name }))}
                    idea={{ id: idea.id, title: idea.title }}
                    label={t("ideas.toEpisode")}
                    variant="secondary"
                  />
                ) : null}
                <IdeaRowActions
                  channelId={channelId}
                  canWrite={canWrite}
                  idea={{
                    id: idea.id,
                    title: idea.title,
                    notes: idea.notes,
                    origin: idea.origin,
                    status: idea.status,
                    signals: idea.signals as IdeaSignals,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {filter === "new" ? (
        <div className="mt-6">
          <OutliersCard
            channelId={channelId}
            outliers={outliers}
            hasCompetitors={competitors.length > 0}
            canIdea={canWrite}
            canConfigure={ctx.can("configure_channel")}
          />
        </div>
      ) : null}
    </Page>
  );
}
