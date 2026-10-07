"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { FORMATS } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { createEpisode } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";

export interface PillarOption {
  id: string;
  name: string;
}

export function NewEpisodeButton({
  channelId,
  pillars,
  defaultFormat = "long",
  idea,
  label,
  variant = "primary",
  autoOpen = false,
}: {
  channelId: string;
  pillars: PillarOption[];
  defaultFormat?: string;
  idea?: { id: string; title: string };
  label?: string;
  variant?: "primary" | "secondary";
  /** Abre el diálogo si la URL trae ?nuevo=1 (barra de comandos). Solo una instancia por página. */
  autoOpen?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const errorText = useActionError();
  const [open, setOpen] = useState(() => autoOpen && params.get("nuevo") === "1");
  const [pending, start] = useTransition();

  function submit(form: FormData) {
    start(async () => {
      const res = await createEpisode({
        channelId,
        title: form.get("title"),
        format: form.get("format"),
        publishDate: form.get("publishDate"),
        recordDate: form.get("recordDate"),
        pillarId: form.get("pillarId"),
        ideaId: idea?.id ?? null,
      });
      if (!res.ok) {
        toast.error(errorText(res.error));
        return;
      }
      setOpen(false);
      router.push(`/c/${channelId}/episodios/${res.data.id}`);
    });
  }

  return (
    <>
      <Button variant={variant} size={idea ? "sm" : "md"} onClick={() => setOpen(true)}>
        {idea ? null : <Plus className="size-4" />} {label ?? t("episode.new")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("episode.new")}>
        <form action={submit} className="grid gap-4 sm:grid-cols-2">
          {idea ? (
            <p className="text-sm text-muted sm:col-span-2">
              {t("episode.fromIdea", { title: idea.title })}
            </p>
          ) : null}
          <Field label={t("episode.title")} htmlFor="ne-title" className="sm:col-span-2">
            <Input
              id="ne-title"
              name="title"
              required
              maxLength={200}
              defaultValue={idea?.title}
              autoFocus
            />
          </Field>
          <Field label={t("episode.publishDate")} htmlFor="ne-pub">
            <Input id="ne-pub" name="publishDate" type="date" />
          </Field>
          <Field label={t("episode.recordDate")} htmlFor="ne-rec">
            <Input id="ne-rec" name="recordDate" type="date" />
          </Field>
          <Field label={t("episode.format")} htmlFor="ne-format">
            <Select id="ne-format" name="format" defaultValue={defaultFormat}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`format.${f}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("episode.pillar")} htmlFor="ne-pillar">
            <Select id="ne-pillar" name="pillarId" defaultValue="">
              <option value="">{t("common.none")}</option>
              {pillars.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("common.create")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
