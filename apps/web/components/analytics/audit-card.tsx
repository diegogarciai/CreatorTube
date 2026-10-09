"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Lightbulb, Loader2, ScrollText } from "lucide-react";
import type { AuditTopicAction } from "@planificador/core";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { auditMonth, auditTopicToIdea } from "@/lib/actions/evaluation";
import type { AuditView } from "@/lib/data/evaluation";
import { createClient } from "@/lib/supabase/browser";
import { AUDIT_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";

const ACTION_TONE: Record<AuditTopicAction, Tone> = { more: "ok", less: "critical", try: "accent" };

const monthName = (month: string) =>
  new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-15T00:00:00Z`),
  );

/**
 * Auditoría mensual (Fase 4 · paso 3): junta las evaluaciones a 7 días de un
 * mes y propone ajustes a la guía del guionista y a los temas, para revisar.
 */
export function AuditCard({
  channelId,
  view,
  canAudit,
  canIdea,
}: {
  channelId: string;
  view: AuditView;
  canAudit: boolean;
  canIdea: boolean;
}) {
  const t = useTranslations("audit");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [month, setMonth] = useState(view.months[0]?.month ?? "");
  const shown = view.audits.find((a) => a.month === month) ?? null;

  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!view.active) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("tasks")
        .select("status")
        .eq("channel_id", channelId)
        .eq("kind", "audit")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status !== "queued" && data.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [view.active, supabase, channelId, router]);

  const working = view.active || shown?.status === "pending";

  return (
    <Card data-testid="audit-card">
      <CardHeader
        title={t("title")}
        description={t("description")}
        action={
          canAudit && view.months.length ? (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <Select
                  aria-label={t("month")}
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-auto min-w-56"
                >
                  {view.months.map((m) => (
                    <option key={m.month} value={m.month}>
                      {t("monthOption", { month: monthName(m.month), count: m.evaluations })}
                    </option>
                  ))}
                </Select>
                <Button
                  onClick={() =>
                    start(async () => {
                      const res = await auditMonth(channelId, month);
                      if (res.ok) {
                        toast.success(t("started"));
                        router.refresh();
                      } else toast.error(errorText(res.error));
                    })
                  }
                  disabled={pending || working || !month}
                  data-testid="audit-month"
                >
                  {pending || working ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ScrollText className="size-4" />
                  )}
                  {shown?.status === "done" ? t("redo") : t("run")}
                </Button>
              </div>
              <span className="text-xs text-muted">
                {t("estimate", { credits: AUDIT_ESTIMATE_CREDITS })}
              </span>
            </div>
          ) : null
        }
      />
      <CardBody className="space-y-4 text-sm">
        {!view.months.length ? <p className="text-muted">{t("empty")}</p> : null}
        {working ? (
          <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
            {t("working")}
          </p>
        ) : null}
        {shown?.status === "failed" || (view.error && !working) ? (
          <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
            {t("failed")} {view.error ? errorText(view.error) : null}
          </p>
        ) : null}
        {view.months.length && !shown && !working ? (
          <p className="text-muted">{t("none", { month: month ? monthName(month) : "" })}</p>
        ) : null}
        {shown?.proposals ? (
          <div className="space-y-4" data-testid="audit-proposals">
            <p className="text-xs text-muted">
              {t("basedOn", { count: shown.evaluations, month: monthName(shown.month) })}
            </p>
            <p>{shown.proposals.summary}</p>
            <section className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{t("guideTitle")}</h3>
                <Link
                  href={`/c/${channelId}/ajustes`}
                  className="text-xs text-accent hover:underline"
                >
                  {t("toGuide")}
                </Link>
              </div>
              {shown.proposals.guide.length ? (
                <ul className="space-y-2" data-testid="audit-guide">
                  {shown.proposals.guide.map((g, i) => (
                    <li key={i} className="rounded-lg border border-border px-3 py-2">
                      <p className="text-xs font-medium text-muted">{g.section}</p>
                      <p>{g.change}</p>
                      <p className="text-xs text-muted">{g.evidence}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">{t("noGuide")}</p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="font-medium">{t("topicsTitle")}</h3>
              {shown.proposals.topics.length ? (
                <ul className="space-y-2" data-testid="audit-topics">
                  {shown.proposals.topics.map((x, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-start gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="flex flex-wrap items-center gap-2">
                          <Badge tone={ACTION_TONE[x.action]}>{t(`action.${x.action}`)}</Badge>
                          <span className="font-medium">{x.topic}</span>
                        </p>
                        <p className="text-xs text-muted">{x.evidence}</p>
                      </div>
                      {canIdea && x.action !== "less" ? (
                        <TopicToIdea channelId={channelId} auditId={shown.id} index={i} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">{t("noTopics")}</p>
              )}
            </section>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function TopicToIdea({
  channelId,
  auditId,
  index,
}: {
  channelId: string;
  auditId: string;
  index: number;
}) {
  const t = useTranslations("audit");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          const res = await auditTopicToIdea(channelId, auditId, index);
          if (res.ok) {
            setDone(true);
            toast.success(t("ideaCreated"));
          } else toast.error(errorText(res.error));
        })
      }
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : done ? (
        <Check className="size-3.5" />
      ) : (
        <Lightbulb className="size-3.5" />
      )}
      {t("toIdea")}
    </Button>
  );
}
