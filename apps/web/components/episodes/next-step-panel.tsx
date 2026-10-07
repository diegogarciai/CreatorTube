"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { ACTION_PHASE, type NextStep } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { completeEpisodeStage, linkEpisodeVideo } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";
import { formatDateKey } from "@/lib/utils";

/** Un solo botón principal según la etapa; el resto de acciones quedan en segundo plano. */
export function NextStepPanel({
  episodeId,
  step,
  canAct,
  canSkip,
}: {
  episodeId: string;
  step: NextStep;
  canAct: boolean;
  canSkip: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(errorText(res.error ?? "errors.unknown"));
    });

  const phase = ACTION_PHASE[step.action];
  const label = t(`action.${step.action}`);

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{t("episode.nextStep")}</p>
      {step.action === "link_video" && canAct ? (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => linkEpisodeVideo(episodeId, url));
          }}
        >
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("episode.linkVideoPlaceholder")}
            aria-label={t("episode.linkVideo")}
            className="min-w-60 flex-1"
            required
          />
          <Button type="submit" disabled={pending}>
            {label}
          </Button>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            disabled={!step.available || !canAct || pending}
            onClick={() => run(() => completeEpisodeStage(episodeId))}
          >
            {label} {step.available ? <ArrowRight className="size-4" /> : null}
          </Button>
          {!step.available && step.action !== "done" && step.action !== "await_publication" ? (
            <span className="text-sm text-muted">
              {step.availableFrom ? t("action.availableFrom", { date: formatDateKey(step.availableFrom) }) : t("common.comingInPhase", { phase })}
            </span>
          ) : null}
          {step.canSkip && canSkip ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => completeEpisodeStage(episodeId))}>
              {t("action.skipStage")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
