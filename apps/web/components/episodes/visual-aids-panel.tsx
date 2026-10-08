"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  Clapperboard,
  Copy,
  Download,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  AID_PIECES,
  pieceLabel,
  planToText,
  scoreTotal,
  validateAidText,
  type AidElement,
  type AidPiece,
  type VisualAid,
} from "@planificador/core";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/form";
import { DeleteButton, RedoButton } from "@/components/episodes/redo-button";
import {
  deletePlan,
  deleteRenders,
  editAid,
  proposeVisualPlan,
  renderAid,
  renderApprovedAids,
  setAidStatus,
} from "@/lib/actions/visual-aids";
import type { AidRenderView, VisualAidView, VisualAidsView } from "@/lib/data/visual-aids";
import { blockersFor, type EpisodeDependents } from "@/lib/dependencies";
import { toVisualAid } from "@/lib/resources";
import { createClient } from "@/lib/supabase/browser";
import { VISUAL_PLAN_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { cn, usd, type ActionResult } from "@/lib/utils";

const KIND_TONE: Record<VisualAidView["kind"], Tone> = { M: "accent", C: "ok", L: "warn" };
const ROW_OK = new Set(["verified", "nuanced"]);

/**
 * Plan de ayudas visuales (sección 12): motion graphics (M), etiquetas de
 * concepto (C) y listas (L). El presentador aprueba, descarta o corrige cada
 * una, y copia el plan aprobado para el editor.
 */
export function VisualAidsPanel({
  episodeId,
  view,
  canEdit,
  deps,
}: {
  episodeId: string;
  view: VisualAidsView;
  canEdit: boolean;
  /** Lo generado del episodio: qué bloquea rehacer o borrar el plan. */
  deps: EpisodeDependents;
}) {
  const t = useTranslations("visualAids");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  // Mientras se arma el plan, se consulta la tarea; al terminar, se recarga.
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!view.active) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("tasks")
        .select("status")
        .eq("episode_id", episodeId)
        .eq("kind", "visual_plan")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status !== "queued" && data.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [view.active, supabase, episodeId, router]);

  // Mientras renderiza, se consulta el estado de los renders; si cambia, se recarga.
  const renderSignature = view.aids
    .flatMap((a) => a.renders.map((r) => `${r.id}:${r.status}`))
    .join(",");
  useEffect(() => {
    if (!view.rendering) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("aid_renders")
        .select("id, status")
        .eq("episode_id", episodeId);
      const now = (data ?? []).map((r) => `${r.id}:${r.status}`);
      if (now.some((x) => !renderSignature.includes(x))) router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [view.rendering, supabase, episodeId, router, renderSignature]);

  const count = (k: VisualAidView["kind"]) =>
    view.aids.filter((a) => a.kind === k && a.status !== "discarded").length;
  const approved = view.aids.filter((a) => a.status === "approved");
  const droppedMotion = view.dropped.filter((d) => d.kind === "M");

  const propose = () => {
    if (view.aids.length && !confirm(t("reproposeConfirm"))) return;
    start(async () => {
      const res = await proposeVisualPlan(episodeId);
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error));
    });
  };

  const renderAll = () =>
    start(async () => {
      const res = await renderApprovedAids(episodeId);
      if (res.ok) {
        toast.success(t("renderStarted"));
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  const remove = (action: () => Promise<ActionResult>) =>
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error));
    });
  const planBlockers = blockersFor({ kind: "plan" }, deps);
  const hasRenders = view.aids.some((a) => a.renders.length);

  const copy = async () => {
    await navigator.clipboard.writeText(planToText(approved.map(toVisualAid)));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card data-testid="visual-aids">
      <CardHeader
        title={t("title")}
        description={t("description")}
        action={
          canEdit ? (
            <div className="flex flex-col items-end gap-1">
              {view.aids.length ? (
                <RedoButton
                  label={t("repropose")}
                  onClick={propose}
                  blockers={planBlockers}
                  pending={view.active}
                  disabled={pending || !view.verified}
                  variant="secondary"
                  size="md"
                  align="end"
                  testId="redo-plan"
                />
              ) : (
                <Button
                  variant="secondary"
                  onClick={propose}
                  disabled={pending || view.active || !view.verified}
                >
                  {view.active ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {t("propose")}
                </Button>
              )}
              <span className="text-xs text-muted">
                {t("estimate", { cost: usd(VISUAL_PLAN_ESTIMATE_CREDITS) })}
              </span>
              {view.aids.length ? (
                <DeleteButton
                  label={t("deletePlan")}
                  confirmText={t("deletePlanConfirm")}
                  onDelete={() => remove(() => deletePlan(episodeId))}
                  blockers={blockersFor({ kind: "deletePlan" }, deps)}
                  disabled={pending || view.active || view.rendering}
                  align="end"
                  testId="delete-plan"
                  showNote={false}
                />
              ) : null}
            </div>
          ) : null
        }
      />
      <CardBody className="space-y-4 text-sm">
        {!view.verified ? (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">{t("notVerified")}</p>
        ) : null}
        {view.active ? (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 className="size-4 animate-spin text-accent" /> {t("working")}
          </p>
        ) : null}
        {view.error ? (
          <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
            {t("failed")} {errorText(view.error)}
          </p>
        ) : null}
        {view.outdated ? (
          <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
            {t("outdated")}
          </p>
        ) : null}

        {view.aids.length ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span data-testid="aids-summary">
                {t("summary", { m: count("M"), c: count("C"), l: count("L") })} ·{" "}
                {t("approved", { count: approved.length })}
              </span>
              <Button size="sm" variant="secondary" onClick={copy} disabled={!approved.length}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? t("copied") : t("copy")}
              </Button>
              {canEdit ? (
                <Button
                  size="sm"
                  onClick={renderAll}
                  disabled={pending || view.rendering || !approved.length}
                >
                  {view.rendering ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Clapperboard className="size-3.5" />
                  )}
                  {t("renderAll", { count: approved.length })}
                </Button>
              ) : null}
              {canEdit && hasRenders ? (
                <DeleteButton
                  label={t("deleteRenders")}
                  confirmText={t("deleteRendersConfirm")}
                  onDelete={() => remove(() => deleteRenders(episodeId))}
                  disabled={pending || view.rendering}
                  testId="delete-renders"
                />
              ) : null}
            </div>
            {view.rendering ? (
              <p className="flex items-center gap-2 text-xs text-muted">
                <Loader2 className="size-3.5 animate-spin text-accent" /> {t("rendering")}
              </p>
            ) : null}
            {count("M") === 0 ? (
              <div
                role="status"
                className="space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-warn"
                data-testid="no-motion"
              >
                <p className="font-medium">{t("noMotion")}</p>
                <p className="text-xs">
                  {droppedMotion.length
                    ? t("noMotionDropped", { count: droppedMotion.length })
                    : t("noMotionNone")}
                </p>
              </div>
            ) : null}
            <ol className="space-y-2">
              {view.aids.map((aid) => (
                <AidItem
                  key={aid.id}
                  episodeId={episodeId}
                  aid={aid}
                  canEdit={canEdit}
                  busy={view.rendering}
                />
              ))}
            </ol>
            {view.dropped.length ? (
              <details className="text-xs" data-testid="dropped-aids" open={count("M") === 0}>
                <summary className="cursor-pointer text-muted">
                  {t("droppedTitle", { count: view.dropped.length })}
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {view.dropped.map((d, i) => (
                    <li
                      key={`${d.code}-${i}`}
                      className="rounded-md border border-border px-2 py-1.5"
                    >
                      <span className="font-medium">
                        {t(`droppedKind.${d.kind ?? "M"}`)}
                        {d.title ? `: ${d.title}` : ""}
                      </span>
                      <span className="text-muted"> · {d.reasons.join(" ")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : !view.active ? (
          <p className="text-muted">{t("empty")}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function AidItem({
  episodeId,
  aid,
  canEdit,
  busy,
}: {
  episodeId: string;
  aid: VisualAidView;
  canEdit: boolean;
  busy: boolean;
}) {
  const t = useTranslations("visualAids");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);

  const status = (next: VisualAidView["status"]) =>
    start(async () => {
      const res = await setAidStatus(aid.id, next);
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error));
    });

  const discarded = aid.status === "discarded";
  return (
    <li
      data-testid={`aid-${aid.code}`}
      className={cn(
        "rounded-lg border px-3 py-2",
        aid.status === "approved" ? "border-ok" : "border-border",
        discarded && "opacity-50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={KIND_TONE[aid.kind]}>{aid.code}</Badge>
        <span className="font-semibold">
          {aid.kind === "C" ? t("concept", { term: aid.title }) : aid.title}
        </span>
        {aid.status === "approved" ? <Badge tone="ok">{t("statusApproved")}</Badge> : null}
        {discarded ? <Badge>{t("statusDiscarded")}</Badge> : null}
        {aid.edited ? <Badge>{t("edited")}</Badge> : null}
        {aid.vertical ? <Badge tone="accent">{t("vertical")}</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-muted">{t("anchor", { anchor: aid.anchor })}</p>

      {editing ? (
        <AidEditor aid={aid} onDone={() => setEditing(false)} />
      ) : (
        <div className="mt-1 space-y-1 text-xs">
          {aid.kind === "M" ? (
            <>
              {aid.idea ? <p>{t("idea", { idea: aid.idea })}</p> : null}
              <p>
                {aid.elements
                  .map((e) => [e.value, e.unit, e.text].filter(Boolean).join(" "))
                  .join(" · ")}
              </p>
              <p className="flex flex-wrap gap-1.5 text-muted">
                {aid.rows.map((r) => (
                  <Badge key={r} tone={ROW_OK.has(aid.rowStatus[r] ?? "") ? "ok" : "critical"}>
                    {t("row", { row: r })}
                  </Badge>
                ))}
                {aid.piece ? <span>{t("piece", { piece: pieceLabel(aid.piece) })}</span> : null}
                {aid.durationS ? <span>{t("duration", { s: aid.durationS })}</span> : null}
                {aid.scores ? <span>{t("score", { score: scoreTotal(aid.scores) })}</span> : null}
              </p>
              {aid.footer ? (
                <p className="text-muted">{t("footer", { footer: aid.footer })}</p>
              ) : null}
            </>
          ) : aid.kind === "C" ? (
            <p>{aid.definition}</p>
          ) : (
            <ul className="list-disc pl-4">
              {aid.elements.map((e, i) => (
                <li key={i}>
                  {e.text}
                  {e.anchor ? <span className="text-muted"> · «{e.anchor}»</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {aid.status === "approved" && aid.renders.length ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {aid.renders.map((r) => (
            <RenderBox key={r.id} render={r} />
          ))}
        </div>
      ) : null}

      {canEdit && !editing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {aid.status === "approved" && aid.renders.length ? (
            // Del render no depende nada generado: siempre se puede rehacer.
            <RedoButton
              label={t("rerender")}
              icon={<RefreshCw className="size-3.5" />}
              blockers={[]}
              disabled={pending || busy}
              onClick={() =>
                start(async () => {
                  const res = await renderAid(aid.id);
                  if (res.ok) router.refresh();
                  else toast.error(errorText(res.error));
                })
              }
            />
          ) : null}
          {aid.renders.length ? (
            <DeleteButton
              label={t("deleteRender")}
              confirmText={t("deleteRenderConfirm")}
              disabled={pending || busy}
              testId={`delete-render-${aid.code}`}
              onDelete={() =>
                start(async () => {
                  const res = await deleteRenders(episodeId, aid.id);
                  if (res.ok) router.refresh();
                  else toast.error(errorText(res.error));
                })
              }
            />
          ) : null}
          {aid.status !== "approved" ? (
            <Button size="sm" onClick={() => status("approved")} disabled={pending}>
              <Check className="size-3.5" /> {t("approve")}
            </Button>
          ) : null}
          {aid.status !== "discarded" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => status("discarded")}
              disabled={pending}
            >
              <Trash2 className="size-3.5" /> {t("discard")}
            </Button>
          ) : null}
          {aid.status !== "proposed" ? (
            <Button size="sm" variant="ghost" onClick={() => status("proposed")} disabled={pending}>
              <Undo2 className="size-3.5" /> {t("undo")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
            <PencilLine className="size-3.5" /> {t("edit")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

const RENDER_TONE: Record<AidRenderView["status"], Tone> = {
  queued: "neutral",
  rendering: "accent",
  ready: "ok",
  failed: "critical",
};

/** Un formato renderizado: vista previa, estado y descarga. */
function RenderBox({ render }: { render: AidRenderView }) {
  const t = useTranslations("visualAids");
  const errorText = useActionError();
  return (
    <div
      className="space-y-1 rounded-lg border border-border p-2"
      data-testid={`render-${render.format}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium">{t(`format.${render.format}`)}</span>
        <Badge tone={RENDER_TONE[render.status]}>{t(`renderStatus.${render.status}`)}</Badge>
        {render.outdated ? <Badge tone="warn">{t("renderOutdated")}</Badge> : null}
        {render.bytes ? (
          <span className="text-muted">{(render.bytes / 1024 / 1024).toFixed(1)} MB</span>
        ) : null}
      </div>
      {render.url ? (
        <video
          src={render.url}
          controls
          loop
          playsInline
          preload="metadata"
          className={cn(
            "w-full rounded",
            render.format === "vertical" ? "aspect-[9/16] max-h-80 object-contain" : "aspect-video",
            render.format === "alpha" &&
              "bg-[conic-gradient(#ccc_25%,#fff_0_50%,#ccc_0_75%,#fff_0)] bg-[length:16px_16px]",
          )}
        />
      ) : null}
      {render.status === "failed" && render.error ? (
        <p className="text-xs text-critical">{errorText(render.error)}</p>
      ) : null}
      {render.downloadUrl ? (
        <a
          href={render.downloadUrl}
          className="inline-flex items-center gap-1 text-xs text-accent underline"
        >
          <Download className="size-3.5" /> {t("download")}
        </a>
      ) : null}
    </div>
  );
}

function AidEditor({ aid, onDone }: { aid: VisualAidView; onDone: () => void }) {
  const t = useTranslations("visualAids");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(aid.title);
  const [idea, setIdea] = useState(aid.idea ?? "");
  const [definition, setDefinition] = useState(aid.definition ?? "");
  const [elements, setElements] = useState<AidElement[]>(aid.elements);
  const [rows, setRows] = useState(aid.rows.join(", "));
  const [footer, setFooter] = useState(aid.footer ?? "");
  const [duration, setDuration] = useState(String(aid.durationS ?? ""));
  const [piece, setPiece] = useState<AidPiece | "">(aid.piece ?? "");

  const parsedRows = rows
    .split(/[,\s]+/)
    .map((r) => Number(r.replace("#", "")))
    .filter((n) => Number.isInteger(n) && n > 0);
  const draft: VisualAid = {
    ...toVisualAid(aid),
    title,
    idea: idea || null,
    definition: definition || null,
    elements: elements.filter((e) => e.text.trim()),
    rows: parsedRows,
    footer: footer || null,
    durationS: Number(duration) || null,
    piece: piece || null,
  };
  // Las reglas 12.4 y 12.5, en vivo (las filas las revisa el servidor).
  const errors = validateAidText(draft);

  const setElement = (i: number, patch: Partial<AidElement>) =>
    setElements((els) => els.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const save = () =>
    start(async () => {
      const res = await editAid(aid.id, {
        title,
        idea: idea || null,
        definition: definition || null,
        elements: draft.elements,
        rows: parsedRows,
        footer: footer || null,
        durationS: Number(duration) || null,
        piece: piece || null,
      });
      if (res.ok) {
        onDone();
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-surface-muted p-3 text-xs">
      <label className="block space-y-1">
        <span>{aid.kind === "C" ? t("fieldTerm") : t("fieldTitle")}</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" />
      </label>
      {aid.kind === "M" ? (
        <label className="block space-y-1">
          <span>{t("fieldIdea")}</span>
          <Input value={idea} onChange={(e) => setIdea(e.target.value)} className="h-8" />
        </label>
      ) : null}
      {aid.kind === "C" ? (
        <label className="block space-y-1">
          <span>{t("fieldDefinition")}</span>
          <Textarea
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            className="min-h-12"
          />
        </label>
      ) : null}
      {aid.kind !== "C" ? (
        <div className="space-y-1">
          <span>{t("fieldElements")}</span>
          {elements.map((e, i) => (
            <div key={i} className="flex flex-wrap gap-1.5">
              {aid.kind === "M" ? (
                <>
                  <Input
                    value={e.value ?? ""}
                    onChange={(ev) => setElement(i, { value: ev.target.value || null })}
                    placeholder={t("fieldValue")}
                    aria-label={t("fieldValue")}
                    className="h-8 w-20"
                  />
                  <Input
                    value={e.unit ?? ""}
                    onChange={(ev) => setElement(i, { unit: ev.target.value || null })}
                    placeholder={t("fieldUnit")}
                    aria-label={t("fieldUnit")}
                    className="h-8 w-16"
                  />
                </>
              ) : null}
              <Input
                value={e.text}
                onChange={(ev) => setElement(i, { text: ev.target.value })}
                aria-label={t("fieldElement", { n: i + 1 })}
                className="h-8 min-w-40 flex-1"
              />
              {aid.kind === "L" ? (
                <Input
                  value={e.anchor ?? ""}
                  onChange={(ev) => setElement(i, { anchor: ev.target.value || null })}
                  placeholder={t("fieldAnchor")}
                  aria-label={t("fieldAnchor")}
                  className="h-8 min-w-32 flex-1"
                />
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setElements((els) => els.filter((_, j) => j !== i))}
                aria-label={t("removeElement")}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setElements((els) => [...els, { text: "" }])}
          >
            <Plus className="size-3.5" /> {t("addElement")}
          </Button>
        </div>
      ) : null}
      {aid.kind === "M" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block space-y-1">
            <span>{t("fieldRows")}</span>
            <Input value={rows} onChange={(e) => setRows(e.target.value)} className="h-8" />
          </label>
          <label className="block space-y-1">
            <span>{t("fieldFooter")}</span>
            <Input value={footer} onChange={(e) => setFooter(e.target.value)} className="h-8" />
          </label>
          <label className="block space-y-1">
            <span>{t("fieldDuration")}</span>
            <Input
              type="number"
              min={1}
              max={60}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="h-8"
            />
          </label>
          <label className="block space-y-1">
            <span>{t("fieldPiece")}</span>
            <Select
              value={piece}
              onChange={(e) => setPiece(e.target.value as AidPiece)}
              className="h-8"
            >
              {AID_PIECES.map((p) => (
                <option key={p} value={p}>
                  {pieceLabel(p)}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}
      {errors.length ? (
        <ul role="alert" className="text-critical" data-testid="aid-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending || errors.length > 0}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
