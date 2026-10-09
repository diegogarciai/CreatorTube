"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Megaphone,
  RotateCcw,
  Send,
  Undo2,
  X,
} from "lucide-react";
import {
  networkRules,
  postSize,
  postWithLink,
  validatePost,
  type CapsuleKind,
} from "@planificador/core";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import {
  dismissSocialPost,
  generateSocialPosts,
  markSocialPostPublished,
  saveSocialPost,
} from "@/lib/actions/social-posts";
import type { EpisodeSocialsView, SocialPostView } from "@/lib/data/social-posts";
import { createClient } from "@/lib/supabase/browser";
import { SOCIAL_POSTS_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { cn } from "@/lib/utils";

const KIND_TONE: Record<CapsuleKind, Tone> = { dato: "accent", mito: "warn", postura: "ok" };

/**
 * Posts para redes (Fase 4 · paso 6): 3 cápsulas por red del canal (el dato,
 * el mito y la postura). Se editan, se copian con el enlace al video y se
 * marcan publicados a mano; el estado queda por red.
 */
export function SocialPostsPanel({
  episodeId,
  channelId,
  view,
  canPublish,
  canConfigure,
}: {
  episodeId: string;
  channelId: string;
  view: EpisodeSocialsView;
  canPublish: boolean;
  canConfigure: boolean;
}) {
  const t = useTranslations("socials");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [withLink, setWithLink] = useState(true);
  const link = withLink ? view.link : null;

  // Mientras se escriben, se consulta la tarea; al terminar, se recarga.
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!view.active) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("tasks")
        .select("status")
        .eq("episode_id", episodeId)
        .eq("kind", "social_posts")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status !== "queued" && data.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [view.active, supabase, episodeId, router]);

  const generate = (network?: string) =>
    start(async () => {
      const res = await generateSocialPosts(episodeId, network);
      if (res.ok) {
        toast.success(t("started"));
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  const missing = view.networks.some((n) => n.posts.length < 3);
  const busy = pending || view.active;

  return (
    <Card data-testid="socials-panel">
      <CardHeader
        title={t("title")}
        description={t("description")}
        action={
          canPublish && view.hasScript && view.networks.length && missing ? (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={() => generate()} disabled={busy} data-testid="generate-posts">
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Megaphone className="size-4" />
                )}
                {t("generate")}
              </Button>
              <span className="text-xs text-muted">
                {t("estimate", { credits: SOCIAL_POSTS_ESTIMATE_CREDITS })}
              </span>
            </div>
          ) : null
        }
      />
      <CardBody className="space-y-4 text-sm">
        {!view.networks.length ? (
          <p className="rounded-lg bg-surface-muted px-3 py-2 text-muted" data-testid="no-socials">
            {t("noNetworks")}{" "}
            {canConfigure ? (
              <a href={`/c/${channelId}/ajustes`} className="text-accent underline">
                {t("toSettings")}
              </a>
            ) : null}
          </p>
        ) : null}
        {!view.hasScript ? <p className="text-muted">{t("noScript")}</p> : null}
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
        {view.link && view.networks.some((n) => n.posts.length) ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={withLink}
              onChange={(e) => setWithLink(e.target.checked)}
            />
            {t("withLink")}
          </label>
        ) : null}
        {view.networks.map((n) =>
          n.posts.length ? (
            <section key={n.network} className="space-y-2" data-testid={`network-${n.network}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{n.label}</h3>
                {n.url ? (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-text"
                  >
                    <ExternalLink className="size-3" /> {t("profile")}
                  </a>
                ) : null}
                <span className="text-xs text-muted">
                  {t("published", {
                    count: n.posts.filter((p) => p.status === "published").length,
                    total: n.posts.length,
                  })}
                </span>
                {canPublish && n.posts.some((p) => p.status !== "published") ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={busy || !view.hasScript}
                    onClick={() =>
                      (!n.posts.some((p) => p.status === "edited") || confirm(t("redoConfirm"))) &&
                      generate(n.network)
                    }
                    data-testid={`redo-${n.network}`}
                  >
                    <RotateCcw className="size-3.5" /> {t("redo")}
                  </Button>
                ) : null}
              </div>
              <ul className="space-y-3">
                {n.posts.map((p) => (
                  <PostItem
                    key={p.id}
                    channelId={channelId}
                    post={p}
                    label={n.label}
                    link={link}
                    canPublish={canPublish}
                  />
                ))}
              </ul>
            </section>
          ) : null,
        )}
        {view.orphans.length ? (
          <section className="space-y-2">
            <h3 className="font-medium">{t("orphans")}</h3>
            <ul className="space-y-3">
              {view.orphans.map((p) => (
                <PostItem
                  key={p.id}
                  channelId={channelId}
                  post={p}
                  label={p.network}
                  link={link}
                  canPublish={canPublish}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {view.networks.length &&
        view.hasScript &&
        !view.active &&
        view.networks.every((n) => !n.posts.length) ? (
          <p className="text-muted">{t("empty")}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function PostItem({
  channelId,
  post: p,
  label,
  link,
  canPublish,
}: {
  channelId: string;
  post: SocialPostView;
  label: string;
  link: string | null;
  canPublish: boolean;
}) {
  const t = useTranslations("socials");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(p.text);
  const published = p.status === "published";
  const dismissed = p.status === "dismissed";
  const rules = networkRules(p.network, label);
  const size = postSize(rules.key, text, link);
  const problems = validatePost(p.network, text, link);
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
      data-testid={`post-${p.network}-${p.kind}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={KIND_TONE[p.kind]}>{t(`kind.${p.kind}`)}</Badge>
        {p.status !== "suggested" ? (
          <Badge tone={published ? "ok" : "neutral"}>{t(`status.${p.status}`)}</Badge>
        ) : null}
        {published && p.postUrl ? (
          <a
            href={p.postUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted hover:text-text"
          >
            <ExternalLink className="size-3" /> {t("openPost")}
          </a>
        ) : null}
        <span
          className={cn(
            "ml-auto tabular-nums",
            size > rules.limit ? "font-medium text-critical" : "text-muted",
          )}
          data-testid={`count-${p.network}-${p.kind}`}
        >
          {size}/{rules.limit}
        </span>
      </div>
      {canPublish && !published ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t("textLabel", { network: label })}
          className="mt-2 min-h-24"
          disabled={dismissed}
        />
      ) : (
        <p className="mt-2 whitespace-pre-line">{text}</p>
      )}
      {problems.length && !published && !dismissed ? (
        <ul className="mt-1 space-y-0.5 text-xs text-critical">
          {problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!text.trim()}
          onClick={() =>
            navigator.clipboard
              .writeText(postWithLink(text, link))
              .then(() => toast.success(t("copied")))
          }
          data-testid={`copy-${p.network}-${p.kind}`}
        >
          <Copy className="size-3.5" /> {t("copy")}
        </Button>
        {canPublish ? (
          <>
            {text.trim() && text !== p.text && !published && !dismissed ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => saveSocialPost(channelId, p.id, text), t("savedToast"))}
                data-testid={`save-${p.network}-${p.kind}`}
              >
                <Check className="size-3.5" /> {t("save")}
              </Button>
            ) : null}
            {!dismissed ? (
              <Button
                size="sm"
                variant={published ? "ghost" : "secondary"}
                disabled={pending}
                onClick={() => {
                  if (published) {
                    run(() => markSocialPostPublished(channelId, p.id, false));
                    return;
                  }
                  const url = prompt(t("urlPrompt", { network: label }), "");
                  if (url === null) return;
                  run(async () => {
                    if (text.trim() && text !== p.text) {
                      const saved = await saveSocialPost(channelId, p.id, text);
                      if (!saved.ok) return saved;
                    }
                    return markSocialPostPublished(channelId, p.id, true, url);
                  }, t("markedToast"));
                }}
                data-testid={`mark-${p.network}-${p.kind}`}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : published ? (
                  <Undo2 className="size-3.5" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {published ? t("unmark") : t("mark")}
              </Button>
            ) : null}
            {!published ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => dismissSocialPost(channelId, p.id, !dismissed))}
              >
                {dismissed ? <Undo2 className="size-3.5" /> : <X className="size-3.5" />}
                {dismissed ? t("undismiss") : t("dismiss")}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
}
