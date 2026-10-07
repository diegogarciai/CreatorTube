import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Lightbulb } from "lucide-react";
import { ideaScore, type IdeaSignals, type IdeaStatus } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { NewEpisodeButton } from "@/components/episodes/new-episode-button";
import { IdeaRowActions, NewIdeaButton } from "@/components/ideas/idea-row-actions";
import { getChannelContext, getSupabase } from "@/lib/auth";
import { getPillars } from "@/lib/data/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ideas" };

const FILTERS: { id: IdeaStatus; key: string }[] = [
  { id: "new", key: "filterNew" },
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
  const [{ data: ideas }, pillars] = await Promise.all([
    supabase.from("ideas").select("*").eq("channel_id", channelId).order("created_at", { ascending: false }),
    getPillars(channelId),
  ]);
  const all = ideas ?? [];
  const shown = all
    .filter((i) => i.status === filter)
    .map((i) => ({ ...i, score: ideaScore(i.signals as IdeaSignals) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const canWrite = ctx.can("write_script");
  const canEpisode = ctx.can("manage_episodes");

  return (
    <Page>
      <PageHeader title={t("ideas.title")} description={t("ideas.subtitle")} actions={canWrite ? <NewIdeaButton channelId={channelId} /> : null} />
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
            {t(`ideas.${f.key}`)} <span className="text-muted">{all.filter((i) => i.status === f.id).length}</span>
          </Link>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="size-8" />}
          title={t("ideas.emptyTitle")}
          description={t("ideas.emptyDesc")}
          action={canWrite && filter === "new" ? <NewIdeaButton channelId={channelId} /> : null}
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {shown.map((idea) => (
            <li key={idea.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{idea.title}</p>
                {idea.notes ? <p className="mt-0.5 line-clamp-2 text-sm text-muted">{idea.notes}</p> : null}
              </div>
              <Badge tone={idea.origin === "pain_point" ? "warn" : idea.origin === "recommendation" ? "accent" : "neutral"}>
                {t(`ideas.originValue.${idea.origin}`)}
              </Badge>
              <span className="w-16 text-right text-sm tabular-nums text-muted" title={t("ideas.score")}>
                {idea.score === null ? "—" : `${idea.score}/100`}
              </span>
              <div className="flex items-center gap-1">
                {canEpisode && idea.status !== "discarded" ? (
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
    </Page>
  );
}
