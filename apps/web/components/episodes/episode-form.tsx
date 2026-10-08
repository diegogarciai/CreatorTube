"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  EPISODE_TYPES,
  FORMATS,
  PRIORITIES,
  SPONSORSHIPS,
  TARGET_MINUTES,
} from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { updateEpisode } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";

export interface EpisodeFormValues {
  title: string;
  format: string;
  priority: string;
  pillarId: string | null;
  publishDate: string | null;
  recordDate: string | null;
  stance: string;
  keywords: string[];
  notes: string;
  episodeType: string | null;
  targetMinutes: number;
  sponsorship: string | null;
  ownMeasurements: string;
  stanceConfirmed: boolean;
}

export function EpisodeForm({
  episodeId,
  initial,
  pillars,
  disabled,
}: {
  episodeId: string;
  initial: EpisodeFormValues;
  pillars: { id: string; name: string }[];
  disabled: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();

  function submit(form: FormData) {
    start(async () => {
      const res = await updateEpisode(episodeId, {
        title: form.get("title"),
        format: form.get("format"),
        priority: form.get("priority"),
        pillarId: form.get("pillarId"),
        publishDate: form.get("publishDate"),
        recordDate: form.get("recordDate"),
        stance: form.get("stance"),
        keywords: String(form.get("keywords") ?? "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        notes: form.get("notes"),
        episodeType: form.get("episodeType"),
        targetMinutes: form.get("targetMinutes"),
        sponsorship: form.get("sponsorship"),
        ownMeasurements: form.get("ownMeasurements"),
        stanceConfirmed: form.get("stanceConfirmed") === "on",
      });
      if (res.ok) toast.success(t("common.saved"));
      else toast.error(errorText(res.error));
    });
  }

  return (
    <form action={submit} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={disabled || pending} className="contents">
        <Field label={t("episode.title")} htmlFor="e-title" className="sm:col-span-2">
          <Input id="e-title" name="title" defaultValue={initial.title} required maxLength={200} />
        </Field>
        <Field label={t("episode.publishDate")} htmlFor="e-pub">
          <Input
            id="e-pub"
            name="publishDate"
            type="date"
            defaultValue={initial.publishDate ?? ""}
          />
        </Field>
        <Field label={t("episode.recordDate")} htmlFor="e-rec">
          <Input id="e-rec" name="recordDate" type="date" defaultValue={initial.recordDate ?? ""} />
        </Field>
        <Field label={t("episode.format")} htmlFor="e-format">
          <Select id="e-format" name="format" defaultValue={initial.format}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`format.${f}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("episode.priority")} htmlFor="e-priority">
          <Select id="e-priority" name="priority" defaultValue={initial.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("episode.pillar")} htmlFor="e-pillar">
          <Select id="e-pillar" name="pillarId" defaultValue={initial.pillarId ?? ""}>
            <option value="">{t("common.none")}</option>
            {pillars.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("episode.keywords")} htmlFor="e-kw">
          <Input
            id="e-kw"
            name="keywords"
            defaultValue={initial.keywords.join(", ")}
            placeholder={t("episode.keywordsPlaceholder")}
          />
        </Field>
        <Field label={t("episode.stance")} htmlFor="e-stance" className="sm:col-span-2">
          <Input
            id="e-stance"
            name="stance"
            defaultValue={initial.stance}
            placeholder={t("episode.stancePlaceholder")}
            maxLength={500}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="stanceConfirmed"
            defaultChecked={initial.stanceConfirmed}
            className="size-4 accent-[var(--accent)]"
          />
          {t("episode.stanceConfirmed")}
        </label>
        <div className="sm:col-span-2">
          <h3 className="text-sm font-semibold">{t("episode.brief")}</h3>
          <p className="text-xs text-muted">{t("episode.briefDesc")}</p>
        </div>
        <Field label={t("episode.episodeType")} htmlFor="e-type">
          <Select id="e-type" name="episodeType" defaultValue={initial.episodeType ?? ""}>
            <option value="">{t("episode.chooseForMe")}</option>
            {EPISODE_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`episodeType.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("episode.targetMinutes")} htmlFor="e-minutes">
          <Select id="e-minutes" name="targetMinutes" defaultValue={String(initial.targetMinutes)}>
            {[...new Set([...TARGET_MINUTES, initial.targetMinutes])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {t("episode.minutes", { count: m })}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("episode.sponsorship")} htmlFor="e-sponsor">
          <Select id="e-sponsor" name="sponsorship" defaultValue={initial.sponsorship ?? ""}>
            <option value="">{t("sponsorship.unconfirmed")}</option>
            {SPONSORSHIPS.map((v) => (
              <option key={v} value={v}>
                {t(`sponsorship.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("episode.ownMeasurements")} htmlFor="e-measure" className="sm:col-span-2">
          <Textarea
            id="e-measure"
            name="ownMeasurements"
            defaultValue={initial.ownMeasurements}
            rows={3}
            maxLength={5000}
            placeholder={t("episode.ownMeasurementsPlaceholder")}
          />
        </Field>
        <Field label={t("episode.notes")} htmlFor="e-notes" className="sm:col-span-2">
          <Textarea id="e-notes" name="notes" defaultValue={initial.notes} rows={5} />
        </Field>
        {!disabled ? (
          <div className="sm:col-span-2">
            <Button type="submit">{pending ? t("common.saving") : t("common.save")}</Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
