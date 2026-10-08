"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Lightbulb, Loader2, Lock, Sparkles } from "lucide-react";
import {
  availableSchemes,
  NO_OPTIONS,
  productPhotosFor,
  SCHEME_IDS,
  THUMBNAIL_SCHEMES,
  validateSchemeSet,
  type SchemeId,
  type ThumbnailOptions,
} from "@planificador/core";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { generateFromIdeas, proposeThumbnailIdeas } from "@/lib/actions/thumbnails";
import type { ThumbnailIdeaView, ThumbnailsView } from "@/lib/data/thumbnails";
import { createClient } from "@/lib/supabase/browser";
import { THUMBNAIL_ESTIMATE_CREDITS, THUMBNAIL_IDEAS_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { cn, usd } from "@/lib/utils";
import { ThumbnailOptionChecks } from "./thumbnail-options";

const PICK = 3;
const LETTERS = ["A", "B", "C"];

const bare = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

/** El texto con su palabra en naranja resaltada. */
function IdeaText({ idea }: { idea: ThumbnailIdeaView }) {
  const parts = idea.text.split(/(\s+)/);
  const hit = parts.findIndex((p) => bare(p) !== "" && bare(p) === bare(idea.accent));
  return (
    <span className="font-semibold">
      {parts.map((part, i) =>
        i === hit ? (
          <span key={i} className="text-accent">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}

/**
 * 30 textos de ángulos distintos alrededor del tema central, agrupados por su
 * esquema de la guía de miniaturas: se marcan 3 de esquemas distintos (al menos
 * uno con cara y uno sin cara) y con ellos se generan las tarjetas A, B y C.
 */
export function ThumbnailIdeas({
  episodeId,
  view,
  canEdit,
  canGenerate,
}: {
  episodeId: string;
  view: ThumbnailsView;
  canEdit: boolean;
  /** Hay fotos del presentador y ninguna miniatura en marcha. */
  canGenerate: boolean;
}) {
  const t = useTranslations("thumbnailIdeas");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const inUse = useMemo(
    () =>
      view.ideas
        .filter((i) => i.slot !== null)
        .sort((a, b) => a.slot! - b.slot!)
        .map((i) => i.id),
    [view.ideas],
  );
  const [picked, setPicked] = useState<string[]>(inUse);
  // Sin texto, sin persona o sin producto, por texto elegido (mandan sobre la guía).
  const [options, setOptions] = useState<Record<string, ThumbnailOptions>>({});
  const [scheme, setScheme] = useState<SchemeId | null>(null);

  // Mientras se proponen los textos, se consulta la tarea; al terminar, se recarga.
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!view.ideasActive) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("tasks")
        .select("status")
        .eq("episode_id", episodeId)
        .eq("kind", "thumbnail_ideas")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status !== "queued" && data.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [view.ideasActive, supabase, episodeId, router]);

  // Sin las fotos del producto que pide, un esquema queda bloqueado.
  const available = availableSchemes(view.refs.length);
  const locked = (id: SchemeId) => !available.includes(id);
  const counts = useMemo(() => {
    const count = new Map<SchemeId, number>();
    for (const i of view.ideas) count.set(i.scheme, (count.get(i.scheme) ?? 0) + 1);
    return count;
  }, [view.ideas]);
  // Primero el set recomendado, después los demás esquemas.
  const order = [...view.recommended, ...SCHEME_IDS.filter((id) => !view.recommended.includes(id))];
  const groups = order
    .filter((id) => counts.get(id) && (!scheme || scheme === id))
    .map((id) => ({ id, ideas: view.ideas.filter((i) => i.scheme === id) }));

  const pickedIdeas = picked.flatMap((id) => view.ideas.filter((i) => i.id === id));
  const pickedSchemes = pickedIdeas.map((i) => i.scheme);
  const optionsOf = (id: string) => options[id] ?? NO_OPTIONS;
  const pickedOptions = pickedIdeas.map((i) => optionsOf(i.id));
  const setErrors = picked.length === PICK ? validateSchemeSet(pickedSchemes, pickedOptions) : [];
  // Un esquema sin las fotos del producto que pide se usa marcando «Sin producto».
  const needsProduct = (i: ThumbnailIdeaView) =>
    productPhotosFor(i.scheme, optionsOf(i.id)) > view.refs.length;
  const pickedLocked = pickedIdeas.some(needsProduct);
  const full = picked.length >= PICK;

  const propose = () => {
    if (view.ideas.length && !confirm(t("reproposeConfirm"))) return;
    start(async () => {
      const res = await proposeThumbnailIdeas(episodeId);
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error));
    });
  };

  const generate = () =>
    start(async () => {
      const res = await generateFromIdeas(episodeId, {
        ideaIds: picked,
        options: picked.map(optionsOf),
      });
      if (res.ok) {
        toast.success(t("generating"));
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < PICK ? [...p, id] : p,
    );

  const schemeLabel = (id: SchemeId) => `${id} · ${THUMBNAIL_SCHEMES[id].name}`;

  return (
    <Card>
      <CardHeader
        title={t("title")}
        description={t("description")}
        action={
          canEdit ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="secondary"
                onClick={propose}
                disabled={pending || view.ideasActive || !view.verdict}
              >
                {view.ideasActive ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Lightbulb className="size-4" />
                )}
                {view.ideas.length ? t("repropose") : t("propose")}
              </Button>
              <span className="text-xs text-muted">
                {t("estimate", { cost: usd(THUMBNAIL_IDEAS_ESTIMATE_CREDITS) })}
              </span>
            </div>
          ) : null
        }
      />
      <CardBody className="space-y-4 text-sm">
        <p className="text-xs text-muted" data-testid="recommended-set">
          {t("recommended", { kind: t(`kind.${view.kind}`), set: view.recommended.join("+") })}
        </p>
        {!view.verdict ? (
          <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
            {t("noVerdict")}
          </p>
        ) : null}
        {view.ideasActive ? (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 className="size-4 animate-spin text-accent" /> {t("working")}
          </p>
        ) : null}
        {view.ideasError ? (
          <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
            {t("failed")} {errorText(view.ideasError)}
          </p>
        ) : null}
        {!view.ideas.length && !view.ideasActive ? (
          <p className="text-muted">{t("empty")}</p>
        ) : null}

        {view.ideas.length ? (
          <>
            <div role="group" aria-label={t("filters")} className="flex flex-wrap gap-1.5">
              {[null, ...order.filter((id) => counts.get(id))].map((id) => (
                <button
                  key={id ?? "all"}
                  type="button"
                  aria-pressed={scheme === id}
                  onClick={() => setScheme(id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    scheme === id
                      ? "border-accent bg-accent-soft font-medium text-text"
                      : "border-border bg-surface text-muted hover:bg-surface-muted",
                  )}
                >
                  {id ? schemeLabel(id) : t("all")} ({id ? counts.get(id) : view.ideas.length})
                </button>
              ))}
            </div>

            {groups.map((g) => {
              const s = THUMBNAIL_SCHEMES[g.id];
              const isLocked = locked(g.id);
              return (
                <section key={g.id} className="space-y-2" data-testid={`scheme-${g.id}`}>
                  <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    {schemeLabel(g.id)}
                    <Badge>{t(`face.${s.face}`)}</Badge>
                    {view.recommended.includes(g.id) ? (
                      <Badge tone="accent">{t("recommendedBadge")}</Badge>
                    ) : null}
                    {isLocked ? (
                      <Badge tone="warn">
                        <Lock className="size-3" /> {t("needsProduct", { count: s.productPhotos })}
                      </Badge>
                    ) : null}
                  </h3>
                  <p className="text-xs text-muted">{s.when}</p>
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {g.ideas.map((idea) => {
                      const pos = picked.indexOf(idea.id);
                      const checked = pos >= 0;
                      const disabled = !checked && full;
                      const body = (
                        <>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <IdeaText idea={idea} />
                            {idea.slot !== null ? (
                              <Badge tone="ok">
                                {t("inUse", { letter: LETTERS[idea.slot] ?? "" })}
                              </Badge>
                            ) : null}
                          </span>
                          {idea.title ? (
                            <span className="mt-0.5 flex items-start gap-1.5 text-xs">
                              <span className="min-w-0 flex-1" data-testid="idea-title">
                                {t("ideaTitle", { title: idea.title })}
                              </span>
                              <CopyButton value={idea.title} />
                            </span>
                          ) : null}
                          <span className="block text-xs text-muted">
                            <Badge className="mr-1">{idea.angle}</Badge>
                            {idea.emotion}
                          </span>
                          {idea.scene ? (
                            <span
                              className="mt-1 line-clamp-2 block text-xs text-muted"
                              title={idea.scene}
                            >
                              {idea.scene}
                            </span>
                          ) : null}
                        </>
                      );
                      return (
                        <li key={idea.id}>
                          {canEdit ? (
                            <label
                              className={cn(
                                "flex h-full cursor-pointer gap-2 rounded-lg border px-3 py-2",
                                checked
                                  ? "border-accent bg-accent-soft"
                                  : "border-border hover:bg-surface-muted",
                                disabled && "cursor-not-allowed opacity-60",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={() => toggle(idea.id)}
                                className="mt-1"
                                aria-label={idea.text}
                              />
                              <span className="min-w-0 flex-1">{body}</span>
                              {checked ? (
                                <Badge tone="accent" className="self-start">
                                  {LETTERS[pos]}
                                </Badge>
                              ) : null}
                            </label>
                          ) : (
                            <div className="h-full rounded-lg border border-border px-3 py-2">
                              {body}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}

            {canEdit ? (
              <div className="sticky bottom-2 space-y-1 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-muted">
                    {t("picked", { count: picked.length })}
                    {pickedSchemes.length ? ` · ${pickedSchemes.join(" + ")}` : ""}
                  </span>
                  <Button
                    onClick={generate}
                    disabled={
                      pending ||
                      picked.length !== PICK ||
                      setErrors.length > 0 ||
                      pickedLocked ||
                      !canGenerate ||
                      !view.verdict
                    }
                  >
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {t("generate")}
                  </Button>
                  <span className="text-xs text-muted">
                    {t("generateEstimate", { cost: usd(THUMBNAIL_ESTIMATE_CREDITS * PICK) })}
                  </span>
                </div>
                {pickedIdeas.length ? (
                  <div className="space-y-1.5 border-t border-border pt-2">
                    <p className="text-xs text-muted">{t("optionsHint")}</p>
                    {pickedIdeas.map((idea, i) => (
                      <div key={idea.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="flex min-w-0 items-center gap-1.5 text-xs">
                          <Badge tone="accent">{LETTERS[i]}</Badge>
                          <span className="font-medium">{idea.scheme}</span>
                          <span className="truncate">{idea.text}</span>
                        </span>
                        <ThumbnailOptionChecks
                          letter={LETTERS[i]!}
                          value={optionsOf(idea.id)}
                          onChange={(next) => setOptions((o) => ({ ...o, [idea.id]: next }))}
                        />
                        {needsProduct(idea) ? (
                          <span className="text-xs text-warn">{t("unlockHint")}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {setErrors.length ? (
                  <ul role="alert" className="text-xs text-critical" data-testid="set-errors">
                    {setErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : picked.length === PICK && !pickedLocked ? (
                  <p className="text-xs text-ok">{t("setOk", { set: pickedSchemes.join("+") })}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
