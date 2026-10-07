"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarDays, CircleCheck, SquarePlay } from "lucide-react";
import { formatDateKey, cn } from "@/lib/utils";
import type { ProductionEpisode } from "./types";

export function EpisodeCard({ episode, channelId, dragging }: { episode: ProductionEpisode; channelId: string; dragging?: boolean }) {
  const t = useTranslations();
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface p-3 text-sm shadow-xs",
        dragging && "rotate-1 shadow-lg ring-2 ring-accent/40",
      )}
    >
      <div className="flex items-start gap-2">
        {episode.pillar ? (
          <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: episode.pillar.color }} title={episode.pillar.name} />
        ) : null}
        <Link
          href={`/c/${channelId}/episodios/${episode.id}`}
          className="line-clamp-3 flex-1 font-medium hover:underline"
        >
          {episode.title}
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>#{episode.number}</span>
        {episode.publishDate ? (
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3" /> {formatDateKey(episode.publishDate)}
          </span>
        ) : null}
        {episode.checklist.total > 0 ? (
          <span className="flex items-center gap-1">
            <CircleCheck className="size-3" /> {episode.checklist.done}/{episode.checklist.total}
          </span>
        ) : null}
        {episode.hasVideo ? <SquarePlay className="size-3" aria-label={t("episode.videoLinked")} /> : null}
        <span className="ml-auto">{t(`format.${episode.format}`)}</span>
      </div>
    </div>
  );
}
