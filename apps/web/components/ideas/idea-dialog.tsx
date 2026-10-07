"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { IDEA_ORIGINS, IDEA_SIGNALS, type IdeaOrigin, type IdeaSignals, type IdeaStatus } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { createIdea, updateIdea } from "@/lib/actions/ideas";
import { useActionError } from "@/lib/use-action-error";

export interface IdeaValues {
  id?: string;
  title: string;
  notes: string;
  origin: IdeaOrigin;
  status: IdeaStatus;
  signals: IdeaSignals;
}

export function IdeaDialog({
  channelId,
  initial,
  trigger,
}: {
  channelId: string;
  initial?: IdeaValues;
  trigger: (open: () => void) => React.ReactNode;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function submit(form: FormData) {
    const signals: Record<string, number> = {};
    for (const s of IDEA_SIGNALS) {
      const v = Number(form.get(`signal-${s}`));
      if (v) signals[s] = v;
    }
    const payload = {
      channelId,
      title: form.get("title"),
      notes: form.get("notes") ?? "",
      origin: form.get("origin"),
      status: initial?.status ?? "new",
      signals,
    };
    start(async () => {
      const res = initial?.id ? await updateIdea(initial.id, payload) : await createIdea(payload);
      if (!res.ok) {
        toast.error(errorText(res.error));
        return;
      }
      setOpen(false);
      toast.success(t("common.saved"));
    });
  }

  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onClose={() => setOpen(false)} title={initial ? t("common.edit") : t("ideas.new")}>
        <form action={submit} className="space-y-4">
          <Field label={t("ideas.titleField")} htmlFor="i-title">
            <Input id="i-title" name="title" required maxLength={200} defaultValue={initial?.title} autoFocus />
          </Field>
          <Field label={t("ideas.notes")} htmlFor="i-notes">
            <Textarea id="i-notes" name="notes" defaultValue={initial?.notes} maxLength={5000} />
          </Field>
          <Field label={t("ideas.origin")} htmlFor="i-origin">
            <Select id="i-origin" name="origin" defaultValue={initial?.origin ?? "own"}>
              {IDEA_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {t(`ideas.originValue.${o}`)}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("ideas.signals")} (1–5)</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {IDEA_SIGNALS.map((s) => (
                <Field key={s} label={<span className="text-xs">{t(`ideas.signal.${s}`)}</span>} htmlFor={`i-${s}`}>
                  <Select id={`i-${s}`} name={`signal-${s}`} defaultValue={initial?.signals[s] ? String(initial.signals[s]) : ""}>
                    <option value="">—</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
