import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Clapperboard, List, SquareKanban, Table2 } from "lucide-react";
import { checklistProgress } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NewEpisodeButton } from "@/components/episodes/new-episode-button";
import { Board } from "@/components/production/board";
import { ListView } from "@/components/production/list-view";
import { TableView } from "@/components/production/table-view";
import type { ProductionEpisode } from "@/components/production/types";
import { getChannelContext } from "@/lib/auth";
import { getChecklistDone, getChecklistSteps, getEpisodes, getPillars } from "@/lib/data/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Producción" };

const VIEWS = [
  { id: "tablero", key: "board", icon: SquareKanban },
  { id: "lista", key: "list", icon: List },
  { id: "tabla", key: "table", icon: Table2 },
] as const;

export default async function ProductionPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ vista?: string; archivados?: string }>;
}) {
  const { channelId } = await params;
  const { vista, archivados } = await searchParams;
  const view = VIEWS.find((v) => v.id === vista)?.id ?? "tablero";
  const showArchived = archivados === "1";
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("production");
  const [rows, pillars, steps, done] = await Promise.all([
    getEpisodes(channelId, showArchived),
    getPillars(channelId, true),
    getChecklistSteps(channelId),
    getChecklistDone(channelId),
  ]);
  const pillarById = new Map(pillars.map((p) => [p.id, p]));
  const episodes: ProductionEpisode[] = rows
    .filter((r) => (showArchived ? r.archived_at !== null : r.archived_at === null))
    .map((r) => {
      const progress = checklistProgress(steps, done.get(r.id) ?? new Set());
      const pillar = r.pillar_id ? pillarById.get(r.pillar_id) : undefined;
      return {
        id: r.id,
        number: r.number,
        code: r.code,
        title: r.title,
        status: r.status,
        stage: r.stage,
        format: r.format,
        publishDate: r.publish_date,
        recordDate: r.record_date,
        pillar: pillar ? { name: pillar.name, color: pillar.color } : null,
        checklist: { done: progress.done, total: progress.total },
        hasVideo: Boolean(r.youtube_video_id),
        archived: Boolean(r.archived_at),
        boardPosition: r.board_position,
      };
    });

  const href = (v: string, arch = showArchived) =>
    `/c/${channelId}/produccion?vista=${v}${arch ? "&archivados=1" : ""}`;
  const newButton = (autoOpen: boolean) =>
    ctx.can("manage_episodes") ? (
      <NewEpisodeButton
        autoOpen={autoOpen}
        channelId={channelId}
        pillars={pillars.filter((p) => !p.archived_at).map((p) => ({ id: p.id, name: p.name }))}
      />
    ) : null;

  return (
    <Page wide>
      <PageHeader
        title={t("title")}
        actions={
          <>
            <div className="flex rounded-lg border border-border bg-surface p-0.5">
              {VIEWS.map((v) => (
                <Link
                  key={v.id}
                  href={href(v.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                    view === v.id ? "bg-surface-muted font-medium" : "text-muted hover:text-text",
                  )}
                >
                  <v.icon className="size-4" /> <span className="hidden sm:inline">{t(v.key)}</span>
                </Link>
              ))}
            </div>
            <Link
              href={href(view, !showArchived)}
              className={cn(
                "self-center text-sm",
                showArchived ? "text-accent" : "text-muted hover:text-text",
              )}
            >
              {t("showArchived")}
            </Link>
            {newButton(true)}
          </>
        }
      />
      {episodes.length === 0 && !showArchived ? (
        <EmptyState
          icon={<Clapperboard className="size-8" />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
          action={newButton(false)}
        />
      ) : view === "tablero" ? (
        <Board episodes={episodes} channelId={channelId} role={ctx.role} />
      ) : view === "lista" ? (
        <ListView episodes={episodes} channelId={channelId} />
      ) : (
        <TableView episodes={episodes} channelId={channelId} />
      )}
    </Page>
  );
}
