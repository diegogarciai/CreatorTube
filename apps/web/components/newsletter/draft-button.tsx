"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { NEWSLETTER_MAX_EPISODES } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { draftNewsletter } from "@/lib/actions/newsletter";
import { NEWSLETTER_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { useNewsletterTaskWatch } from "./use-task-watch";

export interface CandidateEpisode {
  id: string;
  title: string;
  /** Fecha de publicación ya formateada. */
  published: string;
}

/**
 * El semanal: Diego elige los videos que entran (hasta 5) y Claude redacta el
 * resumen. Rehacer pisa lo editado.
 */
export function WeeklyDraft({
  channelId,
  candidates,
  initial,
  active,
  redo,
}: {
  channelId: string;
  candidates: CandidateEpisode[];
  initial: string[];
  active: boolean;
  redo: boolean;
}) {
  const t = useTranslations("newsletter");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string[]>(initial);
  useNewsletterTaskWatch(channelId, null, active);
  const busy = pending || active;
  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="space-y-3 px-5 pb-4" data-testid="weekly-draft">
      {candidates.length ? (
        <ul className="space-y-1.5 text-sm">
          {candidates.map((e) => (
            <li key={e.id}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={picked.includes(e.id)}
                  disabled={
                    busy || (!picked.includes(e.id) && picked.length >= NEWSLETTER_MAX_EPISODES)
                  }
                  onChange={() => toggle(e.id)}
                  aria-label={e.title}
                />
                <span>
                  {e.title} <span className="text-xs text-muted">· {e.published}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t("noCandidates")}</p>
      )}
      <Button
        size="sm"
        disabled={busy || picked.length === 0}
        title={t("estimate", { credits: NEWSLETTER_ESTIMATE_CREDITS })}
        onClick={() =>
          (!redo || confirm(t("redoConfirm"))) &&
          start(async () => {
            const res = await draftNewsletter(channelId, picked);
            if (res.ok) {
              toast.success(t("draftStarted"));
              router.refresh();
            } else toast.error(errorText(res.error));
          })
        }
        data-testid="draft-newsletter"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? t("draftingShort") : redo ? t("redo") : t("draftWeekly", { count: picked.length })}
      </Button>
    </div>
  );
}
