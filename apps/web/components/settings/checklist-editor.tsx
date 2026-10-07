"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Plus } from "lucide-react";
import { CHECKLIST_PHASES, type ChecklistPhase } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import {
  addChecklistStep,
  moveChecklistStep,
  renameChecklistStep,
  setChecklistStepArchived,
} from "@/lib/actions/channels";
import { useActionError } from "@/lib/use-action-error";

interface Step {
  id: string;
  label: string;
  phase: ChecklistPhase;
  position: number;
  archived: boolean;
}

export function ChecklistEditor({ channelId, steps, disabled }: { channelId: string; steps: Step[]; disabled: boolean }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<ChecklistPhase, string>>({ before_publish: "", after_publish: "" });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(errorText(res.error ?? "errors.unknown"));
      else after?.();
    });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {CHECKLIST_PHASES.map((phase) => {
        const active = steps.filter((s) => s.phase === phase && !s.archived).sort((a, b) => a.position - b.position);
        const archived = steps.filter((s) => s.phase === phase && s.archived);
        return (
          <div key={phase}>
            <h3 className="mb-2 text-sm font-semibold">{t(phase === "before_publish" ? "phaseBefore" : "phaseAfter")}</h3>
            <ul className="space-y-1.5">
              {active.map((s, i) => (
                <li key={s.id} className="flex items-center gap-1">
                  <Input
                    defaultValue={s.label}
                    disabled={disabled}
                    className="h-9"
                    aria-label={s.label}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== s.label) run(() => renameChecklistStep(channelId, s.id, v));
                    }}
                  />
                  {!disabled ? (
                    <>
                      <Button variant="ghost" size="sm" aria-label={t("moveUp")} disabled={pending || i === 0} onClick={() => run(() => moveChecklistStep(channelId, s.id, i - 1))}>
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={t("moveDown")} disabled={pending || i === active.length - 1} onClick={() => run(() => moveChecklistStep(channelId, s.id, i + 1))}>
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={tc("archive")} disabled={pending} onClick={() => run(() => setChecklistStepArchived(channelId, s.id, true))}>
                        <Archive className="size-4" />
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            {!disabled ? (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(
                    () => addChecklistStep(channelId, { label: drafts[phase], phase }),
                    () => setDrafts((d) => ({ ...d, [phase]: "" })),
                  );
                }}
              >
                <Input
                  className="h-9"
                  value={drafts[phase]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [phase]: e.target.value }))}
                  placeholder={t("stepLabel")}
                  required
                  maxLength={120}
                />
                <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-label={tc("add")}>
                  <Plus className="size-4" />
                </Button>
              </form>
            ) : null}
            {archived.length > 0 && !disabled ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">
                  {tc("archive")} ({archived.length})
                </summary>
                <ul className="mt-1 space-y-1">
                  {archived.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-muted">
                      <span className="truncate">{s.label}</span>
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setChecklistStepArchived(channelId, s.id, false))}>
                        <ArchiveRestore className="size-4" /> {tc("restore")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
