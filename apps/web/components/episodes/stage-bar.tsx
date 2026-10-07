import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { EPISODE_STAGES, stageIndex, type EpisodeStage } from "@planificador/core";
import { cn } from "@/lib/utils";

export function StageBar({ stage }: { stage: EpisodeStage }) {
  const t = useTranslations("stage");
  const current = stageIndex(stage);
  return (
    <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Etapas">
      {EPISODE_STAGES.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "flex min-w-fit flex-1 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs",
            i < current && "bg-ok-soft text-ok",
            i === current && "bg-accent font-medium text-accent-text",
            i > current && "bg-surface-muted text-muted",
          )}
        >
          {i < current ? (
            <Check className="size-3" />
          ) : (
            <span className="tabular-nums">{i + 1}</span>
          )}
          {t(s)}
        </li>
      ))}
    </ol>
  );
}
