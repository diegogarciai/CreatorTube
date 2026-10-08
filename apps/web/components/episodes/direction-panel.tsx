"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, RotateCcw } from "lucide-react";
import type { DirectionAnswers, DirectionQuestion } from "@planificador/ai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/form";
import { prepareDirection, saveDirection } from "@/lib/actions/direction";
import { createClient } from "@/lib/supabase/browser";
import { DIRECTION_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { cn, usd } from "@/lib/utils";

export interface DirectionState {
  status: "generating" | "ready" | "answered" | "skipped";
  reading: string;
  questions: DirectionQuestion[];
  answers: DirectionAnswers;
  extra: string;
  taskStatus: string | null;
  taskError: string | null;
}

export function DirectionPanel({
  episodeId,
  channelId,
  direction,
  hasGuide,
  canEdit,
}: {
  episodeId: string;
  channelId: string;
  direction: DirectionState | null;
  hasGuide: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("direction");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();

  const generating =
    direction?.status === "generating" &&
    direction.taskStatus !== "failed" &&
    direction.taskStatus !== "canceled";
  const failed = direction?.status === "generating" && !generating;

  // Mientras se preparan, se consulta la fila; al cambiar, se recarga la página.
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("episode_direction")
        .select("status, tasks(status)")
        .eq("episode_id", episodeId)
        .maybeSingle();
      const task = data?.tasks?.status;
      if (data && (data.status !== "generating" || task === "failed" || task === "canceled")) {
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [generating, supabase, episodeId, router]);

  const prepare = () =>
    start(async () => {
      const res = await prepareDirection(episodeId);
      if (!res.ok) toast.error(errorText(res.error));
      else router.refresh();
    });

  const hasQuestions = (direction?.questions.length ?? 0) > 0;

  return (
    <Card id="direccion">
      <CardHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          direction?.status === "answered" ? (
            <Badge tone="ok">{t("answered")}</Badge>
          ) : direction?.status === "skipped" ? (
            <Badge>{t("skipped")}</Badge>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        {!hasGuide ? (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            {t("noGuide")}{" "}
            <Link href={`/c/${channelId}/ajustes`} className="underline">
              {t("goToGuide")}
            </Link>
          </p>
        ) : null}

        {generating ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin text-accent" /> {t("generating")}
          </p>
        ) : null}

        {failed ? (
          <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
            {t("failed")} {direction?.taskError ? `(${errorText(direction.taskError)})` : ""}
          </p>
        ) : null}

        {hasQuestions && !generating && direction ? (
          <DirectionForm
            key={direction.questions.map((q) => q.id + q.question).join("|")}
            episodeId={episodeId}
            direction={direction}
            canEdit={canEdit}
            onPrepare={prepare}
            preparing={pending}
          />
        ) : !generating ? (
          <div className="flex flex-wrap items-center gap-3">
            {direction?.status === "skipped" ? (
              <p className="w-full text-sm text-muted">{t("skippedNoQuestions")}</p>
            ) : null}
            <Button onClick={prepare} disabled={!canEdit || !hasGuide || pending}>
              {failed ? t("retry") : t("prepare")}
            </Button>
            <span className="text-xs text-muted">
              {t("estimate", { cost: usd(DIRECTION_ESTIMATE_CREDITS) })}
            </span>
            {direction?.status !== "skipped" ? (
              <SkipButton episodeId={episodeId} disabled={!canEdit} />
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function DirectionForm({
  episodeId,
  direction,
  canEdit,
  onPrepare,
  preparing,
}: {
  episodeId: string;
  direction: DirectionState;
  canEdit: boolean;
  onPrepare: () => void;
  preparing: boolean;
}) {
  const t = useTranslations("direction");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<DirectionAnswers>(direction.answers ?? {});
  const [extra, setExtra] = useState(direction.extra ?? "");

  const toggle = (q: DirectionQuestion, option: string) =>
    setAnswers((prev) => {
      const cur = prev[q.id] ?? { selected: [], text: "" };
      const on = cur.selected.includes(option);
      const selected = q.multiple
        ? on
          ? cur.selected.filter((o) => o !== option)
          : [...cur.selected, option]
        : on
          ? []
          : [option];
      return { ...prev, [q.id]: { ...cur, selected } };
    });

  const setText = (q: DirectionQuestion, text: string) =>
    setAnswers((prev) => ({ ...prev, [q.id]: { selected: prev[q.id]?.selected ?? [], text } }));

  const save = (skip: boolean) =>
    start(async () => {
      const res = await saveDirection(episodeId, { answers, extra, skip });
      if (!res.ok) toast.error(errorText(res.error));
      else {
        toast.success(skip ? t("skippedToast") : t("savedToast"));
        router.refresh();
      }
    });

  return (
    <div className="space-y-6">
      {direction.reading ? (
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted">
          <span className="font-medium text-text">{t("reading")}</span> {direction.reading}
        </p>
      ) : null}
      <ol className="space-y-5">
        {direction.questions.map((q, i) => {
          const a = answers[q.id];
          return (
            <li key={q.id} className="space-y-2">
              <p className="font-medium">
                {i + 1}. {q.question}
              </p>
              <p className="text-xs text-muted">
                {q.why}
                {q.multiple ? ` · ${t("multiple")}` : ""}
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={q.question}>
                {q.options.map((o) => {
                  const on = a?.selected.includes(o) ?? false;
                  return (
                    <button
                      key={o}
                      type="button"
                      disabled={!canEdit}
                      aria-pressed={on}
                      onClick={() => toggle(q, o)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm",
                        on
                          ? "border-accent bg-accent-soft text-text"
                          : "border-border bg-surface hover:bg-surface-muted",
                      )}
                    >
                      {on ? <Check className="size-3.5 text-accent" /> : null}
                      {o}
                    </button>
                  );
                })}
              </div>
              <Input
                value={a?.text ?? ""}
                onChange={(e) => setText(q, e.target.value)}
                disabled={!canEdit}
                maxLength={2000}
                placeholder={t("ownAnswer")}
                aria-label={t("ownAnswerFor", { n: i + 1 })}
              />
            </li>
          );
        })}
      </ol>
      <div className="space-y-1.5">
        <label htmlFor="direction-extra" className="text-sm font-medium">
          {t("extra")}
        </label>
        <Textarea
          id="direction-extra"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          disabled={!canEdit}
          rows={3}
          maxLength={5000}
          placeholder={t("extraPlaceholder")}
        />
      </div>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled title={t("generateSoon")}>
            {t("generate")}
          </Button>
          <Button variant="secondary" onClick={() => save(false)} disabled={pending}>
            {t("save")}
          </Button>
          <Button variant="ghost" onClick={() => save(true)} disabled={pending}>
            {t("skip")}
          </Button>
          <Button variant="ghost" onClick={onPrepare} disabled={pending || preparing}>
            <RotateCcw className="size-4" /> {t("regenerate")}
          </Button>
          <p className="w-full text-xs text-muted">{t("generateSoon")}</p>
        </div>
      ) : null}
    </div>
  );
}

function SkipButton({ episodeId, disabled }: { episodeId: string; disabled: boolean }) {
  const t = useTranslations("direction");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const res = await saveDirection(episodeId, { answers: {}, extra: "", skip: true });
          if (!res.ok) toast.error(errorText(res.error));
          else router.refresh();
        })
      }
    >
      {t("skip")}
    </Button>
  );
}
