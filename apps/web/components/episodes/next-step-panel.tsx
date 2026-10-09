"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { ACTION_PHASE, type NextStep, type PrimaryAction } from "@planificador/core";
import { Button, buttonClass } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { completeEpisodeStage, linkEpisodeVideo } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";
import { formatDateKey } from "@/lib/utils";

/** Acciones que se hacen en una pestaña del episodio: el botón lleva ahí. */
const ACTION_LINK: Partial<Record<PrimaryAction, string>> = {
  answer_direction: "?tab=script#direccion",
  generate_script: "?tab=script#guion",
  resolve_verification: "?tab=script#guion",
  prepare_assets: "?tab=production",
  share_and_reply: "?tab=distribution",
  evaluate: "?tab=metrics#evaluacion",
};

/** Etapas que se cierran a mano cuando el trabajo en la pestaña está hecho. */
const MANUAL_DONE = new Set<PrimaryAction>([
  "generate_script",
  "resolve_verification",
  "prepare_assets",
  "share_and_reply",
]);

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
  const link = ACTION_LINK[step.action];
  const label = t(`action.${step.action}`);

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {t("episode.nextStep")}
      </p>
      {link && step.available && canAct ? (
        <div className="mt-2">
          <Link href={link} scroll={false} className={buttonClass("primary", "lg")}>
            {label} <ArrowRight className="size-4" />
          </Link>
          {MANUAL_DONE.has(step.action) && canSkip ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-2"
              disabled={pending}
              onClick={() => run(() => completeEpisodeStage(episodeId))}
            >
              {t("action.skipStage")}
            </Button>
          ) : null}
        </div>
      ) : step.action === "link_video" && canAct ? (
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
              {step.availableFrom
                ? t("action.availableFrom", { date: formatDateKey(step.availableFrom) })
                : t("common.comingInPhase", { phase })}
            </span>
          ) : null}
          {step.canSkip && canSkip ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => run(() => completeEpisodeStage(episodeId))}
            >
              {t("action.skipStage")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
