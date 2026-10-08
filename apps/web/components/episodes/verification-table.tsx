"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { decideClaim } from "@/lib/actions/script";
import type { VerificationRow } from "@/lib/data/script";
import { useActionError } from "@/lib/use-action-error";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<VerificationRow["status"], Tone> = {
  pending: "neutral",
  verified: "ok",
  nuanced: "accent",
  unverifiable: "warn",
  contradicted: "critical",
};

const FILTERS = [
  "all",
  "decide",
  "verified",
  "nuanced",
  "unverifiable",
  "contradicted",
  "dato",
  "opinion",
] as const;
type Filter = (typeof FILTERS)[number];

const DECISIONS = ["auto", "rewrite", "remove", "mark", "value"] as const;
type Choice = (typeof DECISIONS)[number];

function matches(row: VerificationRow, filter: Filter) {
  switch (filter) {
    case "all":
      return true;
    case "decide":
      return row.needsDecision;
    case "dato":
    case "opinion":
      return row.kind === filter;
    default:
      return row.kind !== "opinion" && row.status === filter;
  }
}

/**
 * La tabla de la verificación (10.3) con filtros y, en las filas que lo
 * piden, la salida de la regla 10.4 que elige el presentador.
 */
export function VerificationTable({
  episodeId,
  items,
  markdown,
  canEdit,
  onRedo,
  redoCost,
  pending,
}: {
  episodeId: string;
  items: VerificationRow[];
  /** La tabla en Markdown, para copiarla. */
  markdown: string;
  canEdit: boolean;
  /** Rehacer el guion verificado con las decisiones; null si no se puede ahora. */
  onRedo: (() => void) | null;
  redoCost: string;
  pending: boolean;
}) {
  const t = useTranslations("verification");
  const undecided = items.filter((i) => i.needsDecision && !i.decision).length;
  const decided = items.filter((i) => i.needsDecision && i.decision).length;
  const [filter, setFilter] = useState<Filter>(undecided ? "decide" : "all");
  const shown = items.filter((i) => matches(i, filter));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copy"));
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide">{t("title")}</h3>
        <Button variant="ghost" size="sm" onClick={copy}>
          <Copy className="size-3.5" /> {t("copy")}
        </Button>
      </div>

      <div role="group" aria-label={t("filters")} className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = items.filter((i) => matches(i, f)).length;
          if (!count && f !== "all") return null;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                filter === f
                  ? "border-accent bg-accent-soft font-medium text-text"
                  : "border-border bg-surface text-muted hover:bg-surface-muted",
              )}
            >
              {t(`filter.${f}`)} ({count})
            </button>
          );
        })}
      </div>

      <ul className="max-h-[40rem] space-y-2 overflow-auto">
        {shown.map((row) => (
          <Row key={row.idx} row={row} episodeId={episodeId} canEdit={canEdit} />
        ))}
      </ul>

      {canEdit && items.some((i) => i.needsDecision) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
          <span className="text-muted">{t("summary", { decided, undecided })}</span>
          {onRedo ? (
            <>
              <Button size="sm" onClick={onRedo} disabled={pending || decided === 0}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                {t("redo")}
              </Button>
              <span className="text-xs text-muted">{t("redoHint", { cost: redoCost })}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Row({
  row,
  episodeId,
  canEdit,
}: {
  row: VerificationRow;
  episodeId: string;
  canEdit: boolean;
}) {
  const t = useTranslations("verification");
  const errorText = useActionError();
  const router = useRouter();
  const [saving, start] = useTransition();
  const [choice, setChoice] = useState<Choice>(row.decision ?? "auto");
  const [value, setValue] = useState(row.decisionValue ?? row.value ?? "");

  const save = (decision: Choice, v?: string) =>
    start(async () => {
      const res = await decideClaim(episodeId, {
        idx: row.idx,
        decision: decision === "auto" ? null : decision,
        ...(decision === "value" && { value: v }),
      });
      if (!res.ok) {
        toast.error(errorText(res.error));
        setChoice(row.decision ?? "auto");
        return;
      }
      router.refresh();
    });

  const pick = (c: Choice) => {
    setChoice(c);
    if (c !== "value") save(c);
  };

  return (
    <li
      className={cn(
        "space-y-1.5 rounded-lg border px-3 py-2 text-sm",
        row.needsDecision && !row.decision ? "border-warn/50 bg-warn-soft/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-mono">#{row.idx}</span>
        {row.kind === "opinion" ? (
          <Badge>{t("opinion")}</Badge>
        ) : (
          <Badge tone={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
        )}
        {row.kind === "dato" ? <Badge tone="accent">{t("dato")}</Badge> : null}
        {row.nature ? <span>{t(`nature.${row.nature as "brand"}`)}</span> : null}
        {row.date ? <span>· {row.date}</span> : null}
        {row.occurrences > 1 ? <span>· {t("occurrences", { count: row.occurrences })}</span> : null}
      </div>
      <p className="font-medium">{row.claim}</p>
      {row.line ? <p className="text-xs text-muted">«{row.line}»</p> : null}
      {row.value ? (
        <p>
          <span className="text-muted">{t("value")}:</span> {row.value}
        </p>
      ) : null}
      {row.url ? (
        <p className="text-xs">
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent underline"
          >
            {row.sourceTitle || row.url} <ExternalLink className="size-3" />
          </a>
          {row.quote ? <span className="text-muted"> — «{row.quote}»</span> : null}
        </p>
      ) : null}
      {row.note && row.status !== "verified" ? (
        <p className="text-xs text-muted">{row.note}</p>
      ) : null}

      {row.needsDecision ? (
        <fieldset className="space-y-2 pt-1" disabled={!canEdit || saving}>
          <legend className="text-xs font-medium">{t("decisionLabel")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {DECISIONS.map((c) => (
              <label
                key={c}
                className={cn(
                  "cursor-pointer rounded-full border px-2.5 py-1 text-xs",
                  choice === c
                    ? "border-accent bg-accent-soft font-medium"
                    : "border-border bg-surface text-muted hover:bg-surface-muted",
                )}
              >
                <input
                  type="radio"
                  name={`decision-${row.idx}`}
                  value={c}
                  checked={choice === c}
                  onChange={() => pick(c)}
                  className="sr-only"
                />
                {t(`decision.${c}`)}
              </label>
            ))}
            {saving ? <Loader2 className="size-4 animate-spin text-accent" /> : null}
          </div>
          {choice === "value" ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (value.trim()) save("value", value.trim());
              }}
            >
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={300}
                placeholder={t("valuePlaceholder")}
                aria-label={t("valuePlaceholder")}
                className="min-w-48 flex-1"
              />
              <Button size="sm" type="submit" disabled={!value.trim()}>
                {t("saveValue")}
              </Button>
            </form>
          ) : null}
        </fieldset>
      ) : null}
    </li>
  );
}
