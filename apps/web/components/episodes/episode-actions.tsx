"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ExternalLink, Unlink } from "lucide-react";
import { youTubeWatchUrl } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { linkEpisodeVideo, setEpisodeArchived, unlinkEpisodeVideo } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";

export function ArchiveButton({ episodeId, archived }: { episodeId: string; archived: boolean }) {
  const t = useTranslations("episode");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setEpisodeArchived(episodeId, !archived);
          if (!res.ok) toast.error(errorText(res.error));
        })
      }
    >
      {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
      {archived ? t("unarchive") : t("archive")}
    </Button>
  );
}

export function VideoLink({ episodeId, videoId, canEdit }: { episodeId: string; videoId: string | null; canEdit: boolean }) {
  const t = useTranslations("episode");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(errorText(res.error ?? "errors.unknown"));
    });

  if (videoId) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href={youTubeWatchUrl(videoId)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">
          {t("videoLinked")} <ExternalLink className="size-3.5" />
        </a>
        <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{videoId}</code>
        {canEdit ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => unlinkEpisodeVideo(episodeId))}>
            <Unlink className="size-4" /> {t("unlinkVideo")}
          </Button>
        ) : null}
      </div>
    );
  }
  if (!canEdit) return <p className="text-sm text-muted">—</p>;
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => linkEpisodeVideo(episodeId, url));
      }}
    >
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t("linkVideoPlaceholder")}
        aria-label={t("linkVideo")}
        className="min-w-60 flex-1"
        required
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {t("linkVideo")}
      </Button>
    </form>
  );
}
