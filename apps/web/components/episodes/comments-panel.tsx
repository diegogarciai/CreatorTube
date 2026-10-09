"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Loader2, MessagesSquare, Send, Undo2, X } from "lucide-react";
import { COMMENT_KINDS, commentUrl, type CommentKind } from "@planificador/core";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import { ToIdeaButton } from "@/components/audience/pain-to-idea";
import { dismissReply, publishReply, readComments, saveReply } from "@/lib/actions/comments";
import type { CommentView, EpisodeCommentsView } from "@/lib/data/comments";
import { createClient } from "@/lib/supabase/browser";
import { COMMENTS_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { cn } from "@/lib/utils";

const KIND_TONE: Record<CommentKind, Tone> = {
  pregunta_tecnica: "accent",
  correccion: "warn",
  desacuerdo: "warn",
  experiencia: "neutral",
  pedido_tema: "accent",
  elogio: "ok",
  troll_spam: "critical",
};

type Filter = "all" | "open" | "flagged" | CommentKind;

/**
 * Comentarios del episodio (sección 20): se leen a pedido, Claude los
 * clasifica y sugiere la respuesta como Diego, y la respuesta se publica en
 * YouTube solo con la confirmación de quien tiene permiso de publicar.
 */
export function CommentsPanel({
  episodeId,
  channelId,
  view,
  canPublish,
  canIdea = false,
  hasVideo,
}: {
  episodeId: string;
  channelId: string;
  view: EpisodeCommentsView;
  canPublish: boolean;
  /** Puede pasar pedidos, dolores e ideas a Ideas. */
  canIdea?: boolean;
  hasVideo: boolean;
}) {
  const t = useTranslations("comments");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<Filter>("open");

  // Mientras se clasifican, se consulta la tarea; al terminar, se recarga.
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!view.active) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("tasks")
        .select("status")
        .eq("episode_id", episodeId)
        .eq("kind", "comments")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status !== "queued" && data.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [view.active, supabase, episodeId, router]);

  const open = (c: CommentView) =>
    !c.channelReplied && (c.replyStatus === "suggested" || c.replyStatus === "edited");
  const shown = view.comments.filter((c) =>
    filter === "all"
      ? true
      : filter === "open"
        ? open(c) && c.kind !== "troll_spam"
        : filter === "flagged"
          ? c.flags.length > 0
          : c.kind === filter,
  );
  const counts = {
    all: view.comments.length,
    open: view.comments.filter((c) => open(c) && c.kind !== "troll_spam").length,
    flagged: view.comments.filter((c) => c.flags.length > 0).length,
  };

  return (
    <div className="space-y-6" data-testid="comments-panel">
      <Card>
        <CardHeader
          title={t("title")}
          description={t("description")}
          action={
            canPublish && hasVideo ? (
              <div className="flex flex-col items-end gap-1">
                <Button
                  onClick={() =>
                    start(async () => {
                      const res = await readComments(episodeId);
                      if (res.ok) {
                        toast.success(t("fresh", { count: res.data.fresh }));
                        router.refresh();
                      } else toast.error(errorText(res.error));
                    })
                  }
                  disabled={pending || view.active}
                  data-testid="read-comments"
                >
                  {pending || view.active ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <MessagesSquare className="size-4" />
                  )}
                  {t("read")}
                </Button>
                <span className="text-xs text-muted">
                  {t("estimate", { credits: COMMENTS_ESTIMATE_CREDITS })}
                </span>
              </div>
            ) : null
          }
        />
        <CardBody className="space-y-4 text-sm">
          {!hasVideo ? <p className="text-muted">{t("noVideo")}</p> : null}
          {view.active ? (
            <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
              {t("working")}
            </p>
          ) : null}
          {view.error ? (
            <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
              {t("failed")} {errorText(view.error)}
            </p>
          ) : null}
          {canPublish && !view.canPublishReplies && hasVideo ? (
            <p className="rounded-lg bg-surface-muted px-3 py-2 text-muted" data-testid="no-scope">
              {t("noScope")}{" "}
              <a href={`/c/${channelId}/ajustes`} className="text-accent underline">
                {t("toSettings")}
              </a>
            </p>
          ) : null}
          {view.comments.length ? (
            <>
              <div className="flex flex-wrap gap-1.5" role="tablist">
                {(["open", "all", "flagged", ...COMMENT_KINDS] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs",
                      filter === f
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border text-muted hover:text-text",
                    )}
                  >
                    {t(`filter.${f}`)}
                    {f in counts ? ` (${counts[f as keyof typeof counts]})` : ""}
                  </button>
                ))}
              </div>
              <ul className="space-y-3">
                {shown.map((c) => (
                  <CommentItem
                    key={c.id}
                    channelId={channelId}
                    comment={c}
                    canPublish={canPublish}
                    canPublishReplies={view.canPublishReplies}
                    canIdea={canIdea}
                  />
                ))}
              </ul>
              {!shown.length ? <p className="text-muted">{t("noneInFilter")}</p> : null}
            </>
          ) : hasVideo && !view.active ? (
            <p className="text-muted">{t("empty")}</p>
          ) : null}
        </CardBody>
      </Card>
      {view.reading ? (
        <ReadingCard
          reading={view.reading}
          channelId={channelId}
          episodeId={episodeId}
          canIdea={canIdea}
        />
      ) : null}
    </div>
  );
}

function CommentItem({
  channelId,
  comment: c,
  canPublish,
  canPublishReplies,
  canIdea,
}: {
  channelId: string;
  comment: CommentView;
  canPublish: boolean;
  canPublishReplies: boolean;
  canIdea: boolean;
}) {
  const t = useTranslations("comments");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reply, setReply] = useState(c.reply);
  const published = c.replyStatus === "published";
  const dismissed = c.replyStatus === "dismissed";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (done) toast.success(done);
        router.refresh();
      } else toast.error(errorText(res.error ?? "errors.unknown"));
    });
  return (
    <li
      className={cn("rounded-lg border border-border px-3 py-2", dismissed && "opacity-60")}
      data-testid={`comment-${c.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{c.author || t("anonymous")}</span>
        <span className="text-muted">{new Date(c.publishedAt).toLocaleDateString("es")}</span>
        {c.kind ? <Badge tone={KIND_TONE[c.kind]}>{t(`kind.${c.kind}`)}</Badge> : null}
        {!c.kind ? <Badge>{t("unclassified")}</Badge> : null}
        {c.flags.map((f) => (
          <Badge key={f} tone="critical">
            {t(`flag.${f}`)}
          </Badge>
        ))}
        {published ? <Badge tone="ok">{t("published")}</Badge> : null}
        {c.channelReplied && !published ? <Badge tone="ok">{t("answered")}</Badge> : null}
        <a
          href={commentUrl(c.videoId, c.id)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-muted hover:text-text"
        >
          <ExternalLink className="size-3.5" /> {t("open")}
        </a>
      </div>
      <p className="mt-1 whitespace-pre-line">{c.text}</p>
      {c.kind === "pedido_tema" && canIdea ? (
        <div className="mt-2" data-testid={`to-idea-${c.id}`}>
          <ToIdeaButton channelId={channelId} source={{ commentId: c.id }} />
        </div>
      ) : null}

      {c.correction ? (
        <div
          className={cn(
            "mt-2 rounded-md px-2 py-1.5 text-xs",
            c.correction.valid ? "bg-warn-soft text-warn" : "bg-surface-muted text-muted",
          )}
          data-testid={`correction-${c.id}`}
        >
          <p className="font-medium">
            {c.correction.valid ? t("erratumTitle") : t("correctionInvalid")}
          </p>
          <p>
            {t("erratum", {
              said: c.correction.said || "—",
              correct: c.correction.correct || "—",
              source: c.correction.source || "—",
              minute: c.correction.minute || "—",
            })}
          </p>
        </div>
      ) : null}

      {c.kind === "troll_spam" ? (
        <p className="mt-2 text-xs text-muted">{t("trollHint")}</p>
      ) : c.flags.length && !reply ? (
        <p className="mt-2 text-xs text-muted">{t("flaggedHint")}</p>
      ) : null}

      {c.kind && (reply || published || c.kind !== "troll_spam") ? (
        <div className="mt-2 space-y-2">
          {published ? (
            <p className="rounded-md bg-ok-soft px-2 py-1.5 text-ok">{reply}</p>
          ) : canPublish && !c.channelReplied ? (
            <>
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                aria-label={t("replyLabel")}
                className="min-h-16"
                disabled={dismissed}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending || dismissed || !reply.trim() || !canPublishReplies}
                  title={canPublishReplies ? undefined : t("noScope")}
                  onClick={() =>
                    confirm(t("publishConfirm")) &&
                    run(() => publishReply(channelId, c.id, reply), t("publishedToast"))
                  }
                  data-testid={`publish-${c.id}`}
                >
                  {pending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  {t("publish")}
                </Button>
                {reply.trim() && reply !== c.reply && !dismissed ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(() => saveReply(channelId, c.id, reply), t("savedToast"))}
                  >
                    <Check className="size-3.5" /> {t("save")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!reply.trim()}
                  onClick={() =>
                    navigator.clipboard.writeText(reply).then(() => toast.success(t("copied")))
                  }
                >
                  <Copy className="size-3.5" /> {t("copy")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => dismissReply(channelId, c.id, !dismissed))}
                >
                  {dismissed ? <Undo2 className="size-3.5" /> : <X className="size-3.5" />}
                  {dismissed ? t("undismiss") : t("dismiss")}
                </Button>
              </div>
            </>
          ) : reply ? (
            <p className="rounded-md bg-surface-muted px-2 py-1.5 text-muted">{reply}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** La lectura del lote (20.4) del episodio. */
function ReadingCard({
  reading,
  channelId,
  episodeId,
  canIdea,
}: {
  reading: NonNullable<EpisodeCommentsView["reading"]>;
  channelId: string;
  episodeId: string;
  canIdea: boolean;
}) {
  const t = useTranslations("comments");
  const toIdea = (kind: "pain" | "idea") =>
    canIdea
      ? (index: number) => (
          <ToIdeaButton channelId={channelId} source={{ episodeId, index, kind }} />
        )
      : undefined;
  return (
    <Card data-testid="comment-reading">
      <CardHeader title={t("readingTitle")} description={reading.topPain || t("readingDesc")} />
      <CardBody className="grid gap-4 text-sm md:grid-cols-2">
        <ReadingList
          title={t("pains")}
          items={reading.pains.map((p) => `${p.pain} (${p.count}) · «${p.quote}»`)}
          action={toIdea("pain")}
        />
        <ReadingList
          title={t("themes")}
          items={reading.themes.map((x) => `${x.theme} (${x.count})`)}
        />
        <ReadingList
          title={t("questions")}
          items={reading.questions.map((q) => `${q.question}: ${q.trend}`)}
        />
        <ReadingList title={t("corrections")} items={reading.corrections} />
        <ReadingList title={t("ideas")} items={reading.ideas} action={toIdea("idea")} />
      </CardBody>
    </Card>
  );
}

function ReadingList({
  title,
  items,
  action,
}: {
  title: string;
  items: string[];
  /** Un botón por elemento (p. ej. «Pasar a Ideas»). */
  action?: (index: number) => React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-1">
      <h3 className="font-medium">{title}</h3>
      {action ? (
        <ul className="space-y-1.5 text-muted">
          {items.map((x, i) => (
            <li key={i} className="flex items-start justify-between gap-2">
              <span className="min-w-0">{x}</span>
              {action(i)}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="list-disc space-y-0.5 pl-4 text-muted">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
