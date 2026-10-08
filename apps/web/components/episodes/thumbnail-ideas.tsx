"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { generateFromIdeas, proposeThumbnailIdeas } from "@/lib/actions/thumbnails";
import type { ThumbnailIdeaView, ThumbnailsView } from "@/lib/data/thumbnails";
import { createClient } from "@/lib/supabase/browser";
import { THUMBNAIL_ESTIMATE_CREDITS, THUMBNAIL_IDEAS_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { cn, usd } from "@/lib/utils";

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
 * 30 textos de ángulos distintos alrededor del tema central: se marcan 3 y con
 * ellos se generan las miniaturas de las tarjetas A, B y C.
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
  const [angle, setAngle] = useState<string | null>(null);

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

  const angles = useMemo(() => {
    const count = new Map<string, number>();
    for (const i of view.ideas) count.set(i.angle, (count.get(i.angle) ?? 0) + 1);
    return [...count.entries()];
  }, [view.ideas]);
  const shown = angle ? view.ideas.filter((i) => i.angle === angle) : view.ideas;
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
      const res = await generateFromIdeas(episodeId, { ideaIds: picked });
      if (res.ok) {
        toast.success(t("generating"));
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < PICK ? [...p, id] : p,
    );

  return (
    <Card>
      <CardHeader
        title={t("title")}
        description={t("description")}
        action={
          canEdit ? (
            <div className="flex flex-col items-end gap-1">
              <Button variant="secondary" onClick={propose} disabled={pending || view.ideasActive}>
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
              {[[null, view.ideas.length] as const, ...angles].map(([a, count]) => (
                <button
                  key={a ?? "all"}
                  type="button"
                  aria-pressed={angle === a}
                  onClick={() => setAngle(a)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    angle === a
                      ? "border-accent bg-accent-soft font-medium text-text"
                      : "border-border bg-surface text-muted hover:bg-surface-muted",
                  )}
                >
                  {a ?? t("all")} ({count})
                </button>
              ))}
            </div>

            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((idea) => {
                const order = picked.indexOf(idea.id);
                const checked = order >= 0;
                const body = (
                  <>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <IdeaText idea={idea} />
                      {idea.slot !== null ? (
                        <Badge tone="ok">{t("inUse", { letter: LETTERS[idea.slot] ?? "" })}</Badge>
                      ) : null}
                    </span>
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
                          !checked && full && "cursor-not-allowed opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && full}
                          onChange={() => toggle(idea.id)}
                          className="mt-1"
                          aria-label={idea.text}
                        />
                        <span className="min-w-0 flex-1">{body}</span>
                        {checked ? (
                          <Badge tone="accent" className="self-start">
                            {LETTERS[order]}
                          </Badge>
                        ) : null}
                      </label>
                    ) : (
                      <div className="h-full rounded-lg border border-border px-3 py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>

            {canEdit ? (
              <div className="sticky bottom-2 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
                <span className="text-muted">{t("picked", { count: picked.length })}</span>
                <Button
                  onClick={generate}
                  disabled={pending || picked.length !== PICK || !canGenerate}
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
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
