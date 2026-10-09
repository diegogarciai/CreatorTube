"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Mail, Sparkles, ThumbsUp } from "lucide-react";
import { NEWSLETTER_MAX_COMMENTS } from "@planificador/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { draftEpisodeNewsletter } from "@/lib/actions/newsletter";
import type { CandidateComment } from "@/lib/data/newsletter";
import { NEWSLETTER_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";
import { NewsletterEditor, type NewsletterView } from "./editor";
import { useNewsletterTaskWatch } from "./use-task-watch";

/**
 * «Enviar boletín» del episodio: Diego anota sus apreciaciones (opcional),
 * elige los comentarios importantes y Claude redacta el boletín con su voz.
 * Después se edita, se prueba y se envía cuando él quiera.
 */
export function EpisodeNewsletterPanel({
  channelId,
  episodeId,
  notes: initialNotes,
  candidates,
  selected,
  newsletter,
  brand,
  canPublish,
  canSend,
  drafting,
  failed,
}: {
  channelId: string;
  episodeId: string;
  notes: string;
  candidates: CandidateComment[];
  selected: string[];
  newsletter: NewsletterView | null;
  brand: { name: string; accent: string; ink: string };
  canPublish: boolean;
  canSend: boolean;
  drafting: boolean;
  failed: string | null;
}) {
  const t = useTranslations("newsletter");
  const tKind = useTranslations("comments.kind");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState(initialNotes);
  const [picked, setPicked] = useState<string[]>(selected);
  useNewsletterTaskWatch(channelId, episodeId, drafting);
  const busy = pending || drafting;
  const hasDraft = Boolean(newsletter?.subject.trim());
  const locked = newsletter ? newsletter.status !== "draft" : false;
  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  return (
    <div id="boletin" className="scroll-mt-6 space-y-6" data-testid="episode-newsletter">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Mail className="size-4" /> {t("episodeTitle")}
            </span>
          }
          description={t("episodeDesc")}
        />
        {canPublish && !locked ? (
          <CardBody className="space-y-4">
            <Field label={t("notes")} htmlFor="nl-notes" hint={t("notesHint")}>
              <Textarea
                id="nl-notes"
                value={notes}
                maxLength={4000}
                disabled={busy}
                placeholder={t("notesPlaceholder")}
                className="min-h-28"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-medium">
                {t("commentsTitle")}{" "}
                <span className="font-normal text-muted">
                  {t("commentsHint", { count: picked.length, max: NEWSLETTER_MAX_COMMENTS })}
                </span>
              </p>
              {candidates.length ? (
                <ul
                  className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border p-3 text-sm"
                  data-testid="newsletter-comments"
                >
                  {candidates.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={picked.includes(c.id)}
                          disabled={
                            busy ||
                            (!picked.includes(c.id) && picked.length >= NEWSLETTER_MAX_COMMENTS)
                          }
                          onChange={() => toggle(c.id)}
                        />
                        <span className="min-w-0">
                          <span className="line-clamp-3">{c.text}</span>
                          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                            {c.kind ? <Badge>{tKind(c.kind)}</Badge> : null}
                            <ThumbsUp className="size-3" /> {c.likes}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t("noComments")}</p>
              )}
            </div>
            {failed ? (
              <p
                className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical"
                data-testid="newsletter-failed"
              >
                {t("failed")} {failed}
              </p>
            ) : null}
            <Button
              disabled={busy}
              title={t("estimate", { credits: NEWSLETTER_ESTIMATE_CREDITS })}
              onClick={() =>
                (!hasDraft || confirm(t("redoConfirm"))) &&
                start(async () => {
                  const res = await draftEpisodeNewsletter(episodeId, {
                    notes,
                    commentIds: picked,
                  });
                  if (res.ok) {
                    toast.success(t("draftStarted"));
                    router.refresh();
                  } else toast.error(errorText(res.error));
                })
              }
              data-testid="draft-episode-newsletter"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {busy ? t("draftingShort") : hasDraft ? t("redo") : t("draftEpisode")}
            </Button>
            {drafting ? (
              <p role="status" className="text-sm text-warn">
                {t("drafting")}
              </p>
            ) : null}
          </CardBody>
        ) : !newsletter ? (
          <CardBody>
            <p className="text-sm text-muted">{t("episodeNone")}</p>
          </CardBody>
        ) : null}
      </Card>
      {newsletter && hasDraft ? (
        <NewsletterEditor
          key={newsletter.id}
          channelId={channelId}
          newsletter={newsletter}
          brand={brand}
          canPublish={canPublish}
          canSend={canSend}
        />
      ) : null}
    </div>
  );
}
