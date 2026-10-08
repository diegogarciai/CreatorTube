"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { startScript } from "@/lib/actions/script";
import type { ScriptStageView, ScriptStepView, ScriptView } from "@/lib/data/script";
import { createClient } from "@/lib/supabase/browser";
import { SCRIPT_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { cn, usd } from "@/lib/utils";

const STATUS_TONE: Record<string, Tone> = {
  queued: "neutral",
  running: "accent",
  succeeded: "ok",
  failed: "critical",
  incomplete: "warn",
};

type Live = Record<string, { progress: string | null; preview: string | null }>;

/** El paso que conviene mostrar: el que corre, el que falló o el último con texto. */
function focusStep(steps: readonly ScriptStepView[]) {
  return (
    steps.find((s) => s.status === "running") ??
    steps.find((s) => s.status === "failed" || s.status === "incomplete") ??
    [...steps].reverse().find((s) => s.body) ??
    steps[0]
  );
}

export function ScriptPanel({
  episodeId,
  view,
  canEdit,
  directionDone,
  targetMinutes,
  timezone,
}: {
  episodeId: string;
  view: ScriptView;
  canEdit: boolean;
  directionDone: boolean;
  targetMinutes: number;
  timezone: string;
}) {
  const t = useTranslations("script");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const { run, stages, history } = view;
  const active = run?.status === "queued" || run?.status === "running";

  const stepLabel = (s: Pick<ScriptStepView, "key" | "title">) =>
    s.key.startsWith("extra-") ? s.title : t(`step.${s.key}`);

  // Se abre el paso en curso, el que falló o el último con texto.
  const implemented = stages.filter((s) => s.implemented);
  const allSteps = implemented.flatMap((s) => s.steps.map((step) => ({ stage: s, step })));
  const focus =
    allSteps.find((x) => x.step.status === "running") ??
    allSteps.find((x) => x.step.status === "failed" || x.step.status === "incomplete") ??
    [...allSteps].reverse().find((x) => x.step.body) ??
    allSteps[0]!;
  const [sel, setSel] = useState({ stage: focus.stage.stage, step: focus.step.key });
  // Cuando la corrida avanza a otro paso, la selección lo sigue.
  const [followed, setFollowed] = useState(focus.step.key);
  if (followed !== focus.step.key) {
    setFollowed(focus.step.key);
    setSel({ stage: focus.stage.stage, step: focus.step.key });
  }
  const currentStage = stages.find((s) => s.stage === sel.stage) ?? stages[0]!;
  const currentStep =
    currentStage.steps.find((s) => s.key === sel.step) ?? focusStep(currentStage.steps);

  const failed = allSteps.find((x) => x.step.status === "failed" || x.step.status === "incomplete");
  const failReason = run?.error ?? failed?.step.error ?? null;

  // Mientras corre, se consulta el avance; al cambiar un estado, se recarga la página.
  const supabase = useMemo(() => createClient(), []);
  const [live, setLive] = useState<Live>({});
  // Estado conocido de cada paso, como "clave:estado|…"; si cambia, se recarga.
  const known = allSteps.map((x) => `${x.step.key}:${x.step.status}`).join("|");
  const runId = run?.id;
  useEffect(() => {
    if (!active || !runId) return;
    const timer = setInterval(async () => {
      const [{ data: r }, { data: rows }] = await Promise.all([
        supabase.from("script_runs").select("status, tasks(status)").eq("id", runId).single(),
        supabase
          .from("script_step_runs")
          .select("step, status, progress_message, preview")
          .eq("run_id", runId),
      ]);
      setLive(
        Object.fromEntries(
          (rows ?? []).map((s) => [s.step, { progress: s.progress_message, preview: s.preview }]),
        ),
      );
      const seen = known
        .split("|")
        .map((entry) => {
          const [key, status] = entry.split(":");
          const row = rows?.find((x) => x.step === key);
          return `${key}:${row?.status ?? status}`;
        })
        .join("|");
      const task = r?.tasks?.status;
      if (
        (r && r.status !== "queued" && r.status !== "running") ||
        task === "failed" ||
        task === "canceled" ||
        seen !== known
      ) {
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [active, runId, known, supabase, router]);

  const generate = (from: string) =>
    start(async () => {
      const res = await startScript(episodeId, from);
      if (!res.ok) toast.error(errorText(res.error));
      router.refresh();
    });

  const scriptHasContent = stages
    .find((s) => s.stage === "script")
    ?.steps.some((s) => s.key === "teleprompter" && s.body);
  const date = new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  const fromLabel = (stage: string, step: string | null) => {
    const found = step ? stages.flatMap((s) => s.steps).find((s) => s.key === step) : undefined;
    return found ? stepLabel(found) : t(`stage.${stage as "study"}`);
  };
  const index = currentStage.steps.findIndex((s) => s.key === currentStep?.key);

  return (
    <Card id="guion">
      <CardHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          run ? (
            <Badge tone={STATUS_TONE[run.status]} className="whitespace-nowrap">
              {active ? <Loader2 className="size-3 animate-spin" /> : null}
              {t(`status.${run.status}`)}
            </Badge>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        {!directionDone && !run ? (
          <p className="text-sm text-muted">{t("needsDirection")}</p>
        ) : null}

        {run?.status === "failed" ? (
          <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
            {failed
              ? t("failedAt", {
                  step: `${t(`stage.${failed.stage.stage}`)} · ${stepLabel(failed.step)}`,
                })
              : t("failed")}{" "}
            {failReason ? errorText(failReason) : ""} {t("retryHint")}
          </p>
        ) : null}

        {scriptHasContent ? (
          <div
            role="note"
            className="flex items-start gap-2 rounded-lg border border-critical/40 bg-critical-soft px-3 py-2 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical" />
            <div>
              <p className="font-semibold text-critical">{t("unverified")}</p>
              <p className="text-muted">{t("unverifiedHint")}</p>
            </div>
          </div>
        ) : null}

        {run ? (
          <>
            <div
              role="tablist"
              aria-label={t("stages")}
              className="flex gap-1 overflow-x-auto border-b border-border"
            >
              {stages.map((s) => (
                <button
                  key={s.stage}
                  type="button"
                  role="tab"
                  aria-selected={sel.stage === s.stage}
                  onClick={() => setSel({ stage: s.stage, step: focusStep(s.steps)?.key ?? "" })}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm",
                    sel.stage === s.stage
                      ? "border-accent font-medium text-text"
                      : "border-transparent text-muted hover:text-text",
                  )}
                >
                  {t(`stage.${s.stage}`)}
                  <StatusDot status={s.status} label={s.status ? t(`status.${s.status}`) : ""} />
                </button>
              ))}
            </div>

            {!currentStage.implemented ? (
              <p className="text-sm text-muted">{t("comingSoon")}</p>
            ) : (
              <>
                <div role="tablist" aria-label={t("steps")} className="flex flex-wrap gap-1.5">
                  {currentStage.steps.map((s, i) => (
                    <button
                      key={s.key}
                      type="button"
                      role="tab"
                      aria-selected={currentStep?.key === s.key}
                      onClick={() => setSel({ stage: currentStage.stage, step: s.key })}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                        currentStep?.key === s.key
                          ? "border-accent bg-accent-soft font-medium text-text"
                          : "border-border bg-surface text-muted hover:bg-surface-muted",
                      )}
                    >
                      <StepIcon status={s.status} />
                      {s.key.startsWith("extra-") ? null : `${i + 1}. `}
                      {stepLabel(s)}
                    </button>
                  ))}
                </div>
                {currentStep ? (
                  <StepPane
                    step={currentStep}
                    previous={index > 0 ? stepLabel(currentStage.steps[index - 1]!) : null}
                    live={live[currentStep.key]}
                    runActive={active}
                    runFailed={run.status === "failed"}
                    targetMinutes={targetMinutes}
                    onRestart={
                      canEdit && !active && currentStep.canRestart
                        ? () => generate(currentStep.key)
                        : null
                    }
                    pending={pending}
                  />
                ) : null}
              </>
            )}
          </>
        ) : null}

        {canEdit && directionDone ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {!run ? (
              <Button onClick={() => generate("dossier")} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null} {t("generate")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => generate("dossier")}
                disabled={pending || active}
              >
                <RotateCcw className="size-4" /> {t("regenerateAll")}
              </Button>
            )}
            <span className="text-xs text-muted">
              {t("estimate", { cost: usd(SCRIPT_ESTIMATE_CREDITS) })}
            </span>
          </div>
        ) : null}

        {history.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">
              {t("history")} ({history.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {history.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-muted">
                  <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
                  {t("historyRow", {
                    date: date.format(new Date(r.createdAt)),
                    from: fromLabel(r.fromStage, r.fromStep),
                    model: r.model || "—",
                    cost: usd(r.credits),
                  })}
                  {r.id === run?.id ? <Badge tone="accent">{t("current")}</Badge> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}

function StatusDot({ status, label }: { status: ScriptStageView["status"]; label: string }) {
  if (!status) return null;
  return (
    <span
      className={cn("size-2 rounded-full", {
        "bg-ok": status === "succeeded",
        "bg-accent animate-pulse": status === "running",
        "bg-warn": status === "incomplete",
        "bg-critical": status === "failed",
        "bg-border": status === "queued",
      })}
      aria-label={label}
    />
  );
}

function StepIcon({ status }: { status: ScriptStepView["status"] }) {
  if (status === "succeeded") return <Check className="size-3.5 text-ok" />;
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-accent" />;
  if (status === "failed" || status === "incomplete") {
    return <AlertTriangle className="size-3.5 text-warn" />;
  }
  return <span className="size-2 rounded-full border border-border" />;
}

function StepPane({
  step,
  previous,
  live,
  runActive,
  runFailed,
  targetMinutes,
  onRestart,
  pending,
}: {
  step: ScriptStepView;
  previous: string | null;
  live: Live[string] | undefined;
  runActive: boolean;
  runFailed: boolean;
  targetMinutes: number;
  onRestart: (() => void) | null;
  pending: boolean;
}) {
  const t = useTranslations("script");
  const errorText = useActionError();
  const progress = live?.progress ?? step.progress;
  const preview = live?.preview ?? step.preview;

  let content;
  if (step.status === "running") {
    content = (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin text-accent" />
          {progress ?? t("running")}
        </p>
        {preview ? (
          <figure className="space-y-1">
            <figcaption className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("preview")}
            </figcaption>
            <pre
              aria-live="polite"
              className="max-h-40 overflow-hidden whitespace-pre-wrap rounded-lg border border-dashed border-border bg-surface-muted p-3 font-sans text-sm leading-relaxed text-muted"
            >
              {preview}
            </pre>
          </figure>
        ) : null}
      </div>
    );
  } else if (runActive && (step.status === null || step.status === "queued")) {
    content = (
      <p className="text-sm text-muted">{previous ? t("waiting", { previous }) : t("queued")}</p>
    );
  } else if (step.body) {
    content = <BlockView step={step} targetMinutes={targetMinutes} />;
  } else if (step.status === "failed" || step.status === "incomplete") {
    content = null;
  } else {
    content = <p className="text-sm text-muted">{t("notYet")}</p>;
  }

  return (
    <div className="space-y-4">
      {/* Si la corrida falló aquí, el aviso de arriba ya lo dice. */}
      {step.status === "incomplete" || (step.status === "failed" && !runFailed) ? (
        <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {step.status === "incomplete" ? t("incomplete") : t("stageFailed")}{" "}
          {step.error ? errorText(step.error) : ""} {t("retryHint")}
        </p>
      ) : null}
      {content}
      {onRestart ? (
        <Button variant="ghost" size="sm" onClick={onRestart} disabled={pending}>
          <RotateCcw className="size-3.5" /> {t("regenerateHere")}
        </Button>
      ) : null}
    </div>
  );
}

function BlockView({ step, targetMinutes }: { step: ScriptStepView; targetMinutes: number }) {
  const t = useTranslations("script");
  const body = step.body ?? "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copy"));
    }
  };
  const target = targetMinutes * 150;
  const n = new Intl.NumberFormat("es-CO");

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide">{step.title}</h3>
        <div className="flex items-center gap-2">
          {step.words !== null ? (
            <span
              className={cn(
                "text-xs",
                Math.abs(step.words - target) > target * 0.15 ? "text-warn" : "text-muted",
              )}
            >
              {t("words", {
                words: n.format(step.words),
                target: n.format(target),
                minutes: targetMinutes,
              })}
            </span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={copy}>
            <Copy className="size-3.5" /> {t("copy")}
          </Button>
        </div>
      </div>
      {step.plain ? (
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-muted p-4 font-sans text-sm leading-relaxed">
          {body}
        </pre>
      ) : (
        <div className="md max-h-[40rem] overflow-auto rounded-lg border border-border p-4 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}
