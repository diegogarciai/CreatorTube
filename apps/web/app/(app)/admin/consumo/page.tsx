import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { BudgetForm } from "@/components/admin/budget-form";
import { UsageChart } from "@/components/admin/usage-chart";
import { Page, PageHeader } from "@/components/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { isPlatformAdmin } from "@/lib/auth";
import { currentMonth, loadUsageView, type MonthKey } from "@/lib/data/usage";
import { budgetState, sumBy, YOUTUBE_DAILY_QUOTA, type BudgetState } from "@/lib/usage";
import { cn, usd } from "@/lib/utils";

export const metadata: Metadata = { title: "Consumo de servicios" };

const CONSOLES = {
  ai: "https://console.anthropic.com/settings/usage",
  parallel: "https://platform.parallel.ai",
  gemini: "https://aistudio.google.com/usage",
  youtube: "https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas",
  jobs: "https://cloud.trigger.dev",
  artlist: "https://artlist.io",
} as const;

const STATE_TONE: Record<BudgetState, Tone> = {
  none: "neutral",
  ok: "ok",
  warn: "warn",
  over: "critical",
};

/** Dólares a texto (la utilidad recibe créditos de US$0,01). */
const dollars = (v: number) => usd(v * 100);

function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7) as MonthKey;
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; espacio?: string }>;
}) {
  if (!(await isPlatformAdmin())) notFound();
  const params = await searchParams;
  const t = await getTranslations("usage");
  const tAll = await getTranslations();
  // Errores guardados como clave («errors.…») y tipos de tarea, en palabras.
  const errorText = (e: string) => (/^[a-z]+\.[a-zA-Z_.]+$/.test(e) && tAll.has(e) ? tAll(e) : e);
  const kindLabel = (k: string) => (tAll.has(`tasks.kind.${k}`) ? tAll(`tasks.kind.${k}`) : k);
  const now = currentMonth();
  const month = (/^\d{4}-(0[1-9]|1[0-2])$/.test(params.mes ?? "") ? params.mes : now) as MonthKey;
  const workspaceId = params.espacio || null;
  const view = await loadUsageView(month, workspaceId);

  const q = (patch: { mes?: string; espacio?: string | null }) => {
    const sp = new URLSearchParams();
    const mes = patch.mes ?? month;
    if (mes !== now) sp.set("mes", mes);
    const espacio = patch.espacio === undefined ? workspaceId : patch.espacio;
    if (espacio) sp.set("espacio", espacio);
    const s = sp.toString();
    return `/admin/consumo${s ? `?${s}` : ""}`;
  };
  const rawMonth = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(
    new Date(`${month}-15T12:00:00Z`),
  );
  const monthLabel = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
  const wsName = (id: string) => view.workspaces.find((w) => w.id === id)?.name ?? id;
  const n = new Intl.NumberFormat("es-CO");

  // IA, Parallel y Gemini.
  const aiUsd = view.rows.reduce((s, r) => s + r.aiUsd, 0);
  const searchUsd = view.rows.reduce((s, r) => s + r.searchUsd, 0);
  const imageUsd = view.rows.reduce((s, r) => s + r.imageUsd, 0);
  const images = view.rows.reduce((s, r) => s + r.images, 0);
  const calls = view.rows.reduce((s, r) => s + r.calls, 0);
  const tokensIn = view.rows.reduce((s, r) => s + r.input_tokens + r.cache_tokens, 0);
  const tokensOut = view.rows.reduce((s, r) => s + r.output_tokens, 0);
  const searches = view.rows.reduce((s, r) => s + r.searches, 0);
  const aiByWorkspace = sumBy(
    view.rows,
    (r) => r.workspace_id,
    (r) => r.aiUsd,
  );
  const aiByStage = sumBy(
    view.rows,
    (r) => r.stage,
    (r) => r.aiUsd,
  );
  const aiByModel = sumBy(
    view.rows,
    (r) => r.model || "—",
    (r) => r.aiUsd,
  );
  const searchByWorkspace = sumBy(
    view.rows.filter((r) => r.searches > 0),
    (r) => r.workspace_id,
    (r) => r.searchUsd,
  );
  const imageByWorkspace = sumBy(
    view.rows.filter((r) => r.images > 0),
    (r) => r.workspace_id,
    (r) => r.imageUsd,
  );
  const imageByModel = sumBy(
    view.rows.filter((r) => r.images > 0),
    (r) => r.model || "—",
    (r) => r.imageUsd,
  );
  const aiState = budgetState(aiUsd, view.budgets.ai);
  const imageState = budgetState(imageUsd, view.budgets.gemini);
  const searchState = budgetState(searchUsd, view.budgets.parallel);

  // YouTube: cuota de hoy, compartida por todos los canales.
  const quotaToday = view.youtube.reduce((s, c) => s + c.quotaToday, 0);
  const quotaPct = (quotaToday / YOUTUBE_DAILY_QUOTA) * 100;
  const ytState = budgetState(quotaPct, view.budgets.youtube);

  // Motor de tareas.
  const tasksByKind = sumBy(
    view.tasks,
    (r) => r.kind,
    () => 1,
  );
  const failed = view.tasks.filter((r) => r.status === "failed");

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted">
            <ArrowLeft className="size-4" /> {t("back")}
          </Link>
        }
      />
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Link
              href={q({ mes: shiftMonth(month, -1) })}
              aria-label={t("prevMonth")}
              className="rounded-md p-1 hover:bg-surface-muted"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <span className="min-w-36 text-center font-medium">{monthLabel}</span>
            {month < now ? (
              <Link
                href={q({ mes: shiftMonth(month, 1) })}
                aria-label={t("nextMonth")}
                className="rounded-md p-1 hover:bg-surface-muted"
              >
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <span className="size-6" />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Link
              href={q({ espacio: null })}
              className={cn(
                "rounded-full border px-3 py-1",
                !workspaceId ? "border-accent bg-accent-soft font-medium" : "border-border",
              )}
            >
              {t("allWorkspaces")}
            </Link>
            {view.workspaces.map((w) => (
              <Link
                key={w.id}
                href={q({ espacio: w.id })}
                className={cn(
                  "rounded-full border px-3 py-1",
                  workspaceId === w.id
                    ? "border-accent bg-accent-soft font-medium"
                    : "border-border",
                )}
              >
                {w.name}
              </Link>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label={t("totalMonth")} value={dollars(aiUsd + searchUsd + imageUsd)} />
          <Stat
            label={t("ai")}
            value={dollars(aiUsd)}
            state={aiState}
            stateLabel={t(`state.${aiState}`)}
          />
          <Stat
            label={t("parallel")}
            value={dollars(searchUsd)}
            state={searchState}
            stateLabel={t(`state.${searchState}`)}
          />
          <Stat
            label={t("gemini")}
            value={dollars(imageUsd)}
            state={imageState}
            stateLabel={t(`state.${imageState}`)}
          />
          <Stat
            label={t("youtubeToday")}
            value={`${n.format(Math.round(quotaPct * 10) / 10)} %`}
            state={ytState}
            stateLabel={t(`state.${ytState}`)}
          />
        </div>

        <Card>
          <CardHeader title={t("lastMonths")} description={t("lastMonthsHint")} />
          <CardBody>
            <UsageChart months={view.monthly} />
          </CardBody>
        </Card>

        <ServiceCard
          title={t("ai")}
          description={t("aiDesc")}
          href={CONSOLES.ai}
          console={t("console")}
          state={aiState}
          stateLabel={t(`state.${aiState}`)}
          spent={aiUsd}
          budget={view.budgets.ai ?? null}
          budgetForm={<BudgetForm service="ai" value={view.budgets.ai ?? null} />}
          budgetLabel={(spent, budget) =>
            t("budgetOf", { spent: dollars(spent), budget: dollars(budget) })
          }
        >
          <p className="text-sm text-muted">
            {t("aiTotals", {
              calls: n.format(calls),
              input: n.format(Math.round(tokensIn / 1000)),
              output: n.format(Math.round(tokensOut / 1000)),
            })}
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <Breakdown
              title={t("byWorkspace")}
              rows={aiByWorkspace.map(([k, v]) => [wsName(k), dollars(v)])}
              empty={t("empty")}
            />
            <Breakdown
              title={t("byStage")}
              rows={aiByStage.map(([k, v]) => [t(`stage.${k as "study"}`), dollars(v)])}
              empty={t("empty")}
            />
            <Breakdown
              title={t("byModel")}
              rows={aiByModel.map(([k, v]) => [k, dollars(v)])}
              empty={t("empty")}
              mono
            />
          </div>
        </ServiceCard>

        <ServiceCard
          title={t("parallel")}
          description={t("parallelDesc")}
          href={CONSOLES.parallel}
          console={t("console")}
          state={searchState}
          stateLabel={t(`state.${searchState}`)}
          spent={searchUsd}
          budget={view.budgets.parallel ?? null}
          budgetForm={<BudgetForm service="parallel" value={view.budgets.parallel ?? null} />}
          budgetLabel={(spent, budget) =>
            t("budgetOf", { spent: dollars(spent), budget: dollars(budget) })
          }
        >
          <p className="text-sm text-muted">{t("searches", { count: searches })}</p>
          <Breakdown
            title={t("byWorkspace")}
            rows={searchByWorkspace.map(([k, v]) => [wsName(k), dollars(v)])}
            empty={t("empty")}
          />
        </ServiceCard>

        <ServiceCard
          title={t("gemini")}
          description={t("geminiDesc")}
          href={CONSOLES.gemini}
          console={t("console")}
          state={imageState}
          stateLabel={t(`state.${imageState}`)}
          spent={imageUsd}
          budget={view.budgets.gemini ?? null}
          budgetForm={<BudgetForm service="gemini" value={view.budgets.gemini ?? null} />}
          budgetLabel={(spent, budget) =>
            t("budgetOf", { spent: dollars(spent), budget: dollars(budget) })
          }
        >
          <p className="text-sm text-muted">{t("images", { count: images })}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Breakdown
              title={t("byWorkspace")}
              rows={imageByWorkspace.map(([k, v]) => [wsName(k), dollars(v)])}
              empty={t("empty")}
            />
            <Breakdown
              title={t("byModel")}
              rows={imageByModel.map(([k, v]) => [k, dollars(v)])}
              empty={t("empty")}
              mono
            />
          </div>
        </ServiceCard>

        <ServiceCard
          title={t("youtube")}
          description={t("youtubeDesc")}
          href={CONSOLES.youtube}
          console={t("console")}
          state={ytState}
          stateLabel={t(`state.${ytState}`)}
          spent={quotaPct}
          budget={view.budgets.youtube ?? null}
          budgetForm={<BudgetForm service="youtube" value={view.budgets.youtube ?? null} />}
          budgetLabel={(spent, budget) =>
            t("quotaOf", { spent: n.format(Math.round(spent * 10) / 10), budget: n.format(budget) })
          }
        >
          <p className="text-sm text-muted">
            {t("quotaToday", { used: n.format(quotaToday), total: n.format(YOUTUBE_DAILY_QUOTA) })}
          </p>
          {view.youtube.length === 0 ? (
            <p className="text-sm text-muted">{t("noChannels")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {view.youtube.map((c) => (
                <li key={c.channelId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-40 flex-1 font-medium">{c.channel}</span>
                  <Badge tone={c.status === "active" ? "ok" : "warn"}>
                    {t(`connection.${c.status as "active"}`)}
                  </Badge>
                  <span className="text-xs tabular-nums text-muted">
                    {t("units", { count: c.quotaToday })}
                  </span>
                  {c.lastError ? (
                    <span className="w-full text-xs text-critical">{c.lastError}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </ServiceCard>

        <ServiceCard
          title={t("jobs")}
          description={t("jobsDesc")}
          href={CONSOLES.jobs}
          console={t("console")}
        >
          <p className="text-sm text-muted">
            {t("jobsTotals", { total: view.tasks.length, failed: failed.length })}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Breakdown
              title={t("byKind")}
              rows={tasksByKind.map(([k, v]) => [kindLabel(k), n.format(v)])}
              empty={t("empty")}
            />
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
                {t("lastFailed")}
              </h4>
              {failed.length === 0 ? (
                <p className="text-sm text-muted">{t("noFailed")}</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {failed.slice(0, 10).map((f, i) => (
                    <li key={i}>
                      <span className="font-medium">{kindLabel(f.kind)}</span>{" "}
                      <span className="text-muted">
                        ·{" "}
                        {new Date(f.createdAt).toLocaleString("es-CO", {
                          timeZone: "America/Bogota",
                        })}
                      </span>
                      {f.error ? (
                        <span className="block text-critical">{errorText(f.error)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </ServiceCard>

        <ServiceCard
          title={t("artlist")}
          description={t("artlistDesc")}
          href={CONSOLES.artlist}
          console={t("console")}
        >
          <Badge>{t("notConnected")}</Badge>
        </ServiceCard>
      </div>
    </Page>
  );
}

function Stat({
  label,
  value,
  state,
  stateLabel,
}: {
  label: string;
  value: string;
  state?: BudgetState;
  stateLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {state && state !== "none" ? (
        <Badge tone={STATE_TONE[state]} className="mt-1">
          {stateLabel}
        </Badge>
      ) : null}
    </div>
  );
}

function ServiceCard({
  title,
  description,
  href,
  console,
  state,
  stateLabel,
  spent,
  budget,
  budgetForm,
  budgetLabel,
  children,
}: {
  title: string;
  description: string;
  href: string;
  console: string;
  state?: BudgetState;
  stateLabel?: string;
  spent?: number;
  budget?: number | null;
  budgetForm?: React.ReactNode;
  budgetLabel?: (spent: number, budget: number) => string;
  children: React.ReactNode;
}) {
  const ratio = budget ? Math.min(1, (spent ?? 0) / budget) : 0;
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          <div className="flex items-center gap-2">
            {state && state !== "none" ? (
              <Badge tone={STATE_TONE[state]}>{stateLabel}</Badge>
            ) : null}
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-text"
            >
              {console} <ExternalLink className="size-3" />
            </a>
          </div>
        }
      />
      <CardBody className="space-y-4">
        {children}
        {budgetForm ? (
          <div className="space-y-2 border-t border-border pt-3">
            {budget && budgetLabel ? (
              <>
                <p className="text-xs text-muted">{budgetLabel(spent ?? 0, budget)}</p>
                <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                  <div
                    className={cn(
                      "h-full rounded-full",
                      state === "over" ? "bg-critical" : state === "warn" ? "bg-warn" : "bg-ok",
                    )}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              </>
            ) : null}
            {budgetForm}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Breakdown({
  title,
  rows,
  empty,
  mono = false,
}: {
  title: string;
  rows: [string, string][];
  empty: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-3">
              <span className={cn("truncate", mono && "font-mono text-xs")}>{k}</span>
              <span className="tabular-nums">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
