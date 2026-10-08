"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, RotateCcw } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { startScript } from "@/lib/actions/script";
import type { ScriptBlockView, ScriptStageView, ScriptView } from "@/lib/data/script";
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

  // Primera etapa con contenido o en curso; si no, Estudio.
  // Se abre la etapa en curso, la que falló o la última con contenido.
  const failedStage = stages.find((s) => s.status === "failed" || s.status === "incomplete");
  const firstUseful =
    stages.find((s) => s.status === "running") ??
    failedStage ??
    [...stages].reverse().find((s) => s.blocks.length > 0) ??
    stages[0]!;
  const failReason = run?.error ?? failedStage?.error ?? null;
  const [tab, setTab] = useState(firstUseful.stage);
  // Cuando la corrida avanza a otra etapa, la pestaña la sigue.
  const [followed, setFollowed] = useState(firstUseful.stage);
  if (followed !== firstUseful.stage) {
    setFollowed(firstUseful.stage);
    setTab(firstUseful.stage);
  }
  const current = stages.find((s) => s.stage === tab) ?? stages[0]!;

  // Mientras corre, se consulta el avance; al cambiar un estado, se recarga la página.
  const supabase = useMemo(() => createClient(), []);
  const [live, setLive] = useState<
    Record<string, { progress: string | null; preview: string | null }>
  >({});
  useEffect(() => {
    if (!active || !run) return;
    const known = stages.map((s) => `${s.stage}:${s.status}`).join("|");
    const timer = setInterval(async () => {
      const [{ data: r }, { data: rows }] = await Promise.all([
        supabase.from("script_runs").select("status, tasks(status)").eq("id", run.id).single(),
        supabase
          .from("script_stage_runs")
          .select("stage, status, progress_message, preview")
          .eq("run_id", run.id),
      ]);
      setLive(
        Object.fromEntries(
          (rows ?? []).map((s) => [s.stage, { progress: s.progress_message, preview: s.preview }]),
        ),
      );
      const seen = stages
        .map((s) => `${s.stage}:${rows?.find((x) => x.stage === s.stage)?.status ?? null}`)
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
  }, [active, run, stages, supabase, router]);

  const generate = (from: "study" | "script") =>
    start(async () => {
      const res = await startScript(episodeId, from);
      if (!res.ok) toast.error(errorText(res.error));
      router.refresh();
    });

  const studyReady = stages.find((s) => s.stage === "study")?.status === "succeeded";
  const scriptHasContent = (stages.find((s) => s.stage === "script")?.blocks.length ?? 0) > 0;
  const date = new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });

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
            {failedStage ? t("failedAt", { stage: t(`stage.${failedStage.stage}`) }) : t("failed")}{" "}
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
            <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
              {stages.map((s) => (
                <button
                  key={s.stage}
                  type="button"
                  role="tab"
                  aria-selected={tab === s.stage}
                  onClick={() => setTab(s.stage)}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm",
                    tab === s.stage
                      ? "border-accent font-medium text-text"
                      : "border-transparent text-muted hover:text-text",
                  )}
                >
                  {t(`stage.${s.stage}`)}
                  {s.status ? (
                    <span
                      className={cn("size-2 rounded-full", {
                        "bg-ok": s.status === "succeeded",
                        "bg-accent animate-pulse": s.status === "running",
                        "bg-warn": s.status === "incomplete",
                        "bg-critical": s.status === "failed",
                        "bg-border": s.status === "queued",
                      })}
                      aria-label={t(`status.${s.status}`)}
                    />
                  ) : null}
                </button>
              ))}
            </div>
            <StagePane
              stage={current}
              progress={live[current.stage]?.progress ?? current.progress}
              preview={live[current.stage]?.preview ?? current.preview}
              runActive={active}
              runFailed={run.status === "failed"}
              targetMinutes={targetMinutes}
            />
          </>
        ) : null}

        {canEdit && directionDone ? (
          <div className="flex flex-wrap items-center gap-2">
            {!run ? (
              <Button onClick={() => generate("study")} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null} {t("generate")}
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => generate("study")}
                  disabled={pending || active}
                >
                  <RotateCcw className="size-4" />
                  {t("regenerateFrom", { stage: t("stage.study") })}
                </Button>
                {studyReady ? (
                  <Button
                    variant="secondary"
                    onClick={() => generate("script")}
                    disabled={pending || active}
                  >
                    <RotateCcw className="size-4" />
                    {t("regenerateFrom", { stage: t("stage.script") })}
                  </Button>
                ) : null}
              </>
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
                    stage: t(`stage.${r.fromStage}`),
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

function StagePane({
  stage,
  progress,
  preview,
  runActive,
  runFailed,
  targetMinutes,
}: {
  stage: ScriptStageView;
  progress: string | null;
  preview: string | null;
  runActive: boolean;
  runFailed: boolean;
  targetMinutes: number;
}) {
  const t = useTranslations("script");
  const errorText = useActionError();

  if (!stage.implemented) return <p className="text-sm text-muted">{t("comingSoon")}</p>;
  if (stage.status === "running" || (runActive && stage.status === "queued")) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin text-accent" />
          {progress ?? (stage.status === "running" ? t("running") : t("queued"))}
        </p>
        {stage.status === "running" && preview ? (
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
  }
  return (
    <div className="space-y-4">
      {/* Si la corrida falló aquí, el aviso de arriba ya lo dice. */}
      {stage.status === "incomplete" || (stage.status === "failed" && !runFailed) ? (
        <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {stage.status === "incomplete" ? t("incomplete") : t("stageFailed")}{" "}
          {stage.error ? errorText(stage.error) : ""} {t("retryHint")}
        </p>
      ) : null}
      {stage.blocks.length === 0 && !stage.status ? (
        <p className="text-sm text-muted">{runActive ? t("queued") : t("notYet")}</p>
      ) : null}
      {stage.blocks.map((b) => (
        <BlockView key={b.title} block={b} targetMinutes={targetMinutes} />
      ))}
    </div>
  );
}

function BlockView({ block, targetMinutes }: { block: ScriptBlockView; targetMinutes: number }) {
  const t = useTranslations("script");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.body);
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
        <h3 className="text-sm font-semibold tracking-wide">{block.title}</h3>
        <div className="flex items-center gap-2">
          {block.words !== null ? (
            <span
              className={cn(
                "text-xs",
                Math.abs(block.words - target) > target * 0.15 ? "text-warn" : "text-muted",
              )}
            >
              {t("words", {
                words: n.format(block.words),
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
      {block.plain ? (
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-muted p-4 font-sans text-sm leading-relaxed">
          {block.body}
        </pre>
      ) : (
        <div className="md max-h-[40rem] overflow-auto rounded-lg border border-border p-4 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.body}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}
