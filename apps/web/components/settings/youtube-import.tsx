"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  findImportableVideos,
  importYouTubeVideos,
  type ImportableVideo,
} from "@/lib/actions/youtube-import";
import { IMPORT_CREDITS_PER_VIDEO } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { usd } from "@/lib/utils";

/**
 * Importa los videos ya publicados como episodios. Los largos vienen marcados
 * y los Shorts no; Claude propone pilar, keywords y postura si se deja la
 * casilla marcada.
 */
export function YouTubeImport({ channelId, timezone }: { channelId: string; timezone: string }) {
  const t = useTranslations("import");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [videos, setVideos] = useState<ImportableVideo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [useAi, setUseAi] = useState(true);
  const [done, setDone] = useState<{ created: number; withAi: boolean } | null>(null);

  const date = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: timezone });
  const minutes = (s: number | null) =>
    s === null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const search = () =>
    start(async () => {
      const res = await findImportableVideos(channelId);
      if (!res.ok) {
        toast.error(errorText(res.error));
        return;
      }
      setDone(null);
      setVideos(res.data.videos);
      setSelected(new Set(res.data.videos.filter((v) => !v.short).map((v) => v.id)));
    });

  const runImport = () =>
    start(async () => {
      const res = await importYouTubeVideos(channelId, { videoIds: [...selected], useAi });
      if (!res.ok) {
        toast.error(errorText(res.error));
        return;
      }
      setDone({ created: res.data.created, withAi: Boolean(res.data.taskId) });
      setVideos(null);
      router.refresh();
    });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const count = selected.size;
  const cost = usd(Math.max(1, Math.ceil(count * IMPORT_CREDITS_PER_VIDEO)));

  return (
    <div className="space-y-4 text-sm">
      {done ? (
        <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-ok">
          {t(done.withAi ? "doneWithAi" : "done", { count: done.created })}{" "}
          <Link href={`/c/${channelId}/produccion`} className="underline">
            {t("goToProduction")}
          </Link>
        </p>
      ) : null}

      {videos === null ? (
        <Button variant="secondary" onClick={search} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {t("search")}
        </Button>
      ) : videos.length === 0 ? (
        <p className="text-muted">{t("nothing")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted">{t("found", { count: videos.length })}</p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set(videos.map((v) => v.id)))}
              >
                {t("selectAll")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                {t("selectNone")}
              </Button>
            </div>
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-auto rounded-lg border border-border">
            {videos.map((v) => (
              <li key={v.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={selected.has(v.id)}
                    onChange={() => toggle(v.id)}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{v.title}</span>
                  {v.short ? <Badge>{t("short")}</Badge> : null}
                  <span className="whitespace-nowrap text-xs text-muted">
                    {date.format(new Date(v.publishedAt))}
                    {v.durationSeconds !== null ? ` · ${minutes(v.durationSeconds)}` : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={useAi}
              onChange={(e) => setUseAi(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--accent)]"
            />
            <span>
              {t("useAi")}
              <span className="block text-xs text-muted">
                {useAi && count ? t("useAiCost", { cost }) : t("useAiHint")}
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={runImport} disabled={pending || count === 0}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {t("import", { count })}
            </Button>
            <Button variant="ghost" onClick={() => setVideos(null)} disabled={pending}>
              {t("cancel")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
