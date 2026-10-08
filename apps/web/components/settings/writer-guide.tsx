"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  DEFAULT_STAGE_SECTIONS,
  parseGuide,
  stagesBySection,
  validateGuide,
  type StageSections,
} from "@planificador/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { publishWriterGuide } from "@/lib/actions/channels";
import { useActionError } from "@/lib/use-action-error";

export interface GuideVersionSummary {
  id: string;
  version: number;
  createdAt: string;
  author: string | null;
  notes: string | null;
}

export interface CurrentGuide extends GuideVersionSummary {
  sections: { key: string; title: string; length: number }[];
  stageSections: StageSections;
}

export function WriterGuide({
  channelId,
  current,
  versions,
  disabled,
}: {
  channelId: string;
  current: CurrentGuide | null;
  versions: GuideVersionSummary[];
  disabled: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(current === null);
  const [content, setContent] = useState("");
  const [notes, setNotes] = useState("");
  const deferred = useDeferredValue(content);
  const stages = current?.stageSections ?? DEFAULT_STAGE_SECTIONS;

  const preview = useMemo(() => {
    if (!deferred.trim()) return null;
    const parsed = parseGuide(deferred);
    return { parsed, check: validateGuide(parsed, stages) };
  }, [deferred, stages]);

  function submit() {
    start(async () => {
      const res = await publishWriterGuide(channelId, { content, notes });
      if (!res.ok) {
        toast.error(errorText(res.error));
        return;
      }
      toast.success(t("guide.published"));
      setContent("");
      setNotes("");
      setEditing(false);
    });
  }

  return (
    <div className="space-y-5">
      {current ? (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">{t("guide.versionN", { n: current.version })}</span>
            <span className="text-muted">
              {" · "}
              {current.createdAt}
              {current.author ? ` · ${current.author}` : ""}
            </span>
            {current.notes ? <span className="block text-muted">{current.notes}</span> : null}
          </p>
          <SectionsTable sections={current.sections} stages={current.stageSections} />
        </div>
      ) : (
        <p className="text-sm text-muted">{t("guide.empty")}</p>
      )}

      {disabled ? null : editing ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <Field label={t("guide.paste")} htmlFor="guide-content">
            <Textarea
              id="guide-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder={t("guide.pastePlaceholder")}
            />
          </Field>
          {preview ? (
            preview.check.ok ? (
              <p className="text-sm text-ok">
                {t("guide.detected", { count: preview.parsed.sections.length })}
              </p>
            ) : (
              <p role="alert" className="text-sm text-critical">
                {preview.parsed.sections.length === 0
                  ? t("errors.guide_no_sections")
                  : t("guide.missing", { sections: preview.check.missing.join(", ") })}
              </p>
            )
          ) : null}
          {preview && preview.parsed.sections.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">{t("guide.previewSections")}</summary>
              <div className="mt-2">
                <SectionsTable
                  sections={preview.parsed.sections.map((s) => ({
                    key: s.key,
                    title: s.title,
                    length: s.body.length,
                  }))}
                  stages={stages}
                />
              </div>
            </details>
          ) : null}
          <Field label={t("guide.notes")} htmlFor="guide-notes">
            <Input
              id="guide-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              placeholder={t("guide.notesPlaceholder")}
            />
          </Field>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={pending || !preview?.check.ok}>
              {pending ? t("common.saving") : t("guide.publish")}
            </Button>
            {current ? (
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t("guide.newVersion")}
        </Button>
      )}

      {versions.length > 1 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t("guide.history")}</summary>
          <ul className="mt-2 divide-y divide-border">
            {versions.map((v) => (
              <li key={v.id} className="py-2">
                <span className="font-medium">{t("guide.versionN", { n: v.version })}</span>
                <span className="text-muted">
                  {" · "}
                  {v.createdAt}
                  {v.author ? ` · ${v.author}` : ""}
                </span>
                {v.notes ? <span className="block text-muted">{v.notes}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SectionsTable({
  sections,
  stages,
}: {
  sections: { key: string; title: string; length: number }[];
  stages: StageSections;
}) {
  const t = useTranslations();
  const by = stagesBySection(stages);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 pr-3 font-normal">#</th>
            <th className="py-1 pr-3 font-normal">{t("guide.section")}</th>
            <th className="py-1 font-normal">{t("guide.usedBy")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sections.map((s) => (
            <tr key={s.key}>
              <td className="py-1.5 pr-3 align-top tabular-nums text-muted">{s.key}</td>
              <td className="py-1.5 pr-3 align-top">{s.title}</td>
              <td className="py-1.5 align-top">
                <div className="flex flex-wrap gap-1">
                  {(by[s.key] ?? []).length === 0 ? (
                    <span className="text-xs text-muted">{t("guide.noStage")}</span>
                  ) : (
                    (by[s.key] ?? []).map((st) => <Badge key={st}>{t(`guideStage.${st}`)}</Badge>)
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
