"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardCheck, Loader2, RotateCcw } from "lucide-react";
import { metricTrend, type EvalMetric, type Verdict } from "@planificador/core";
import { clockLabel, percentLabel } from "@/components/analytics/stat-tiles";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { evaluateEpisode } from "@/lib/actions/evaluation";
import type { EpisodeEvaluationView } from "@/lib/data/evaluation";
import { createClient } from "@/lib/supabase/browser";
import { EVALUATION_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { cn, formatDateKey } from "@/lib/utils";

export const VERDICT_TONE: Record<Verdict, Tone> = {
  above: "ok",
  inline: "neutral",
  below: "critical",
};

const int = new Intl.NumberFormat("es-CO");

/** Una cifra de la evaluación con su formato. */
export function metricLabel(metric: EvalMetric, v: number | null) {
  if (v === null) return "—";
  if (metric === "ctr") return percentLabel(v * 100);
  if (metric === "averageViewPercentage") return percentLabel(v);
  if (metric === "averageViewDurationS") return clockLabel(v);
  if (metric === "subscribersNet") return `${v >= 0 ? "+" : ""}${int.format(Math.round(v))}`;
  return int.format(Math.round(v));
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Evaluación a 7 días (Fase 4 · paso 3): la primera semana contra la mediana
 * de los episodios anteriores, los párrafos con más caída y lo que aprende
 * Claude. Los números los calcula la app.
 */
export function EvaluationCard({
  episodeId,
  view,
  canEvaluate,
}: {
  episodeId: string;
  view: EpisodeEvaluationView;
  canEvaluate: boolean;
}) {
  const t = useTranslations("evaluation");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const working = view.active || view.status === "pending";
  const data = view.status === "done" ? view.data : null;

  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!view.active) return;
    const timer = setInterval(async () => {
      const { data: task } = await supabase
        .from("tasks")
        .select("status")
        .eq("episode_id", episodeId)
        .eq("kind", "evaluation")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (task && task.status !== "queued" && task.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [view.active, supabase, episodeId, router]);

  const evaluate = () =>
    start(async () => {
      const res = await evaluateEpisode(episodeId);
      if (res.ok) {
        toast.success(t("started"));
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  return (
    <Card data-testid="evaluation-card" id="evaluacion">
      <CardHeader
        title={t("title")}
        description={t("description", {
          from: formatDateKey(view.window.from),
          to: formatDateKey(view.window.to),
        })}
        action={
          canEvaluate && view.ready && !working ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant={data ? "ghost" : "primary"}
                size={data ? "sm" : "md"}
                onClick={evaluate}
                disabled={pending}
                data-testid="evaluate"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : data ? (
                  <RotateCcw className="size-3.5" />
                ) : (
                  <ClipboardCheck className="size-4" />
                )}
                {data ? t("redo") : t("evaluate")}
              </Button>
              {!data ? (
                <span className="text-xs text-muted">
                  {t("estimate", { credits: EVALUATION_ESTIMATE_CREDITS })}
                </span>
              ) : null}
            </div>
          ) : null
        }
      />
      <CardBody className="space-y-4 text-sm">
        {!view.ready && view.status === "none" ? (
          <p className="text-muted" data-testid="evaluation-wait">
            {t("notReady", { date: formatDateKey(addDays(view.window.to, 3)) })}
          </p>
        ) : null}
        {view.ready && view.status === "none" && !working ? (
          <p className="text-muted">{t("ready")}</p>
        ) : null}
        {working ? (
          <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
            {t("working")}
          </p>
        ) : null}
        {view.status === "failed" || (view.error && !working) ? (
          <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
            {t("failed")} {view.error ? errorText(view.error) : null}
          </p>
        ) : null}
        {data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {data.verdict ? (
                <span data-testid="evaluation-verdict">
                  <Badge tone={VERDICT_TONE[data.verdict]}>{t(`verdict.${data.verdict}`)}</Badge>
                </span>
              ) : null}
              <span className="text-xs text-muted">
                {t("baseline", { count: data.baseline.count })}
              </span>
            </div>
            <p>{data.summary}</p>
            {data.learnings.length ? (
              <section className="space-y-1">
                <h3 className="font-medium">{t("learnings")}</h3>
                <ol className="list-decimal space-y-1 pl-5" data-testid="evaluation-learnings">
                  {data.learnings.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        ) : null}
        {view.data && (data || working) ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm" data-testid="evaluation-metrics">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-1.5 pr-3 font-medium">{t("col.metric")}</th>
                    <th className="px-3 py-1.5 text-right font-medium">{t("col.episode")}</th>
                    <th className="px-3 py-1.5 text-right font-medium">{t("col.median")}</th>
                    <th className="py-1.5 pl-3 text-right font-medium">{t("col.delta")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.data.metrics.map((m) => {
                    const trend = metricTrend(m);
                    return (
                      <tr key={m.metric} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-3">{t(`metric.${m.metric}`)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {metricLabel(m.metric, m.value)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted">
                          {metricLabel(m.metric, m.median)}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 pl-3 text-right tabular-nums",
                            trend === "above" && "text-ok",
                            trend === "below" && "text-critical",
                            (trend === "inline" || trend === null) && "text-muted",
                          )}
                        >
                          {m.delta === null
                            ? "—"
                            : `${m.delta > 0 ? "+" : m.delta < 0 ? "−" : ""}${Math.abs(Math.round(m.delta * 100))} %`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">{t("computed")}</p>
            {view.data.drops.length ? (
              <section className="space-y-1">
                <h3 className="font-medium">{t("drops")}</h3>
                <ul className="space-y-1" data-testid="evaluation-drops">
                  {view.data.drops.map((d) => (
                    <li key={d.index} className="text-muted">
                      <span className="font-medium text-critical">
                        −{Math.round(d.drop * 100)} %
                      </span>{" "}
                      {t("paragraph", { n: d.index + 1 })}: {d.text}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
