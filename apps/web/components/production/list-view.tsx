"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { EPISODE_STATUSES } from "@planificador/core";
import { formatDateKey } from "@/lib/utils";
import type { ProductionEpisode } from "./types";

export function ListView({
  episodes,
  channelId,
}: {
  episodes: ProductionEpisode[];
  channelId: string;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-6">
      {EPISODE_STATUSES.map((status) => {
        const group = episodes.filter((e) => e.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status}>
            <h2 className="mb-2 text-sm font-semibold">
              {t(`status.${status}`)}{" "}
              <span className="font-normal text-muted">· {group.length}</span>
            </h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {group.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/c/${channelId}/episodios/${e.id}`}
                    className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-muted"
                  >
                    <span className="w-10 shrink-0 text-muted">#{e.number}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                    <span className="hidden text-muted sm:inline">{t(`stage.${e.stage}`)}</span>
                    <span className="w-20 shrink-0 text-right text-muted">
                      {formatDateKey(e.publishDate)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
