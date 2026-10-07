"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FORMATS, WEEKDAYS, type EpisodeFormat } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { updateChannelRhythm } from "@/lib/actions/channels";
import { useActionError } from "@/lib/use-action-error";
import { cn } from "@/lib/utils";

export interface RhythmValues {
  weeklyGoal: number;
  publishWeekdays: number[];
  recordWeekdays: number[];
  formats: EpisodeFormat[];
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-9 rounded-lg border px-3 text-sm",
        on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface text-muted hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

export function RhythmForm({ channelId, initial, disabled }: { channelId: string; initial: RhythmValues; disabled?: boolean }) {
  const t = useTranslations();
  const errorText = useActionError();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateChannelRhythm(channelId, v);
      if (res.ok) toast.success(t("common.saved"));
      else toast.error(errorText(res.error));
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={disabled || pending} className="space-y-5">
        <Field label={t("settings.weeklyGoal")} htmlFor="r-goal">
          <Input
            id="r-goal"
            type="number"
            min={0}
            max={21}
            value={v.weeklyGoal}
            onChange={(e) => setV({ ...v, weeklyGoal: Number(e.target.value) })}
            className="w-28"
          />
        </Field>
        <Field label={t("settings.publishDays")}>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <Toggle key={d} on={v.publishWeekdays.includes(d)} onClick={() => setV({ ...v, publishWeekdays: toggle(v.publishWeekdays, d) })}>
                {t(`weekdayShort.${d}`)}
              </Toggle>
            ))}
          </div>
        </Field>
        <Field label={t("settings.recordDays")}>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <Toggle key={d} on={v.recordWeekdays.includes(d)} onClick={() => setV({ ...v, recordWeekdays: toggle(v.recordWeekdays, d) })}>
                {t(`weekdayShort.${d}`)}
              </Toggle>
            ))}
          </div>
        </Field>
        <Field label={t("settings.formats")}>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <Toggle key={f} on={v.formats.includes(f)} onClick={() => setV({ ...v, formats: toggle(v.formats, f) })}>
                {t(`format.${f}`)}
              </Toggle>
            ))}
          </div>
        </Field>
        <Button type="submit">{pending ? t("common.saving") : t("common.save")}</Button>
      </fieldset>
    </form>
  );
}
