"use client";

import { useOptimistic, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { checklistProgress, type ChecklistPhase, type ChecklistStep } from "@planificador/core";
import { toggleChecklistItem } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";

export function ChecklistPanel({
  episodeId,
  steps,
  done,
  phase,
  disabled,
}: {
  episodeId: string;
  steps: ChecklistStep[];
  done: string[];
  phase: ChecklistPhase;
  disabled: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    new Set(done),
    (state, { id, on }: { id: string; on: boolean }) => {
      const next = new Set(state);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    },
  );
  const active = steps
    .filter((s) => s.phase === phase && !s.archivedAt)
    .sort((a, b) => a.position - b.position);
  const progress = checklistProgress(steps, optimistic, phase);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <h3 className="font-medium">
          {t(phase === "before_publish" ? "episode.checklistBefore" : "episode.checklistAfter")}
        </h3>
        <span className="text-muted">
          {progress.done}/{progress.total}
        </span>
      </div>
      {active.length === 0 ? (
        <p className="text-sm text-muted">{t("episode.noChecklist")}</p>
      ) : (
        <ul className="space-y-1">
          {active.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={optimistic.has(s.id)}
                  disabled={disabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    start(async () => {
                      setOptimistic({ id: s.id, on });
                      const res = await toggleChecklistItem(episodeId, s.id, on);
                      if (!res.ok) toast.error(errorText(res.error));
                    });
                  }}
                />
                <span className={optimistic.has(s.id) ? "text-muted line-through" : ""}>
                  {s.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
