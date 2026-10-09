"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Eye, Loader2, Send, TestTube2 } from "lucide-react";
import {
  NEWSLETTER_LIMITS,
  newsletterWords,
  validateNewsletter,
  type NewsletterDraft,
} from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { saveNewsletter, sendNewsletter, sendNewsletterTest } from "@/lib/actions/newsletter";
import { renderNewsletterEmail } from "@/lib/newsletter-email";
import { useActionError } from "@/lib/use-action-error";
import { cn } from "@/lib/utils";

export interface NewsletterView extends NewsletterDraft {
  id: string;
  weekStart: string;
  status: "draft" | "scheduled" | "sent" | string;
  ctaUrl: string;
  scheduledAt: string | null;
  sentAt: string | null;
  testSentAt: string | null;
}

const L = NEWSLETTER_LIMITS;
const len = (s: string) => [...s.trim()].length;

function Counter({ value, max, min }: { value: number; max: number; min?: number }) {
  const bad = value > max || (min !== undefined && value < min);
  return (
    <span className={cn("tabular-nums", bad ? "text-critical" : "text-muted")}>
      {min !== undefined ? `${value} (${min}–${max})` : `${value}/${max}`}
    </span>
  );
}

/** El borrador de la semana: edición con topes, vista previa, prueba y envío. */
export function NewsletterEditor({
  channelId,
  newsletter: n,
  brand,
  canPublish,
  canSend,
}: {
  channelId: string;
  newsletter: NewsletterView;
  brand: { name: string; accent: string; ink: string };
  canPublish: boolean;
  /** Hay clave, remitente y segmento. */
  canSend: boolean;
}) {
  const t = useTranslations("newsletter");
  const errorText = useActionError();
  const router = useRouter();
  const [d, setD] = useState({
    subject: n.subject,
    preheader: n.preheader,
    body: n.body,
    ctaText: n.ctaText,
    ctaUrl: n.ctaUrl,
    point: n.point,
  });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState<null | "now" | "schedule">(null);
  const [when, setWhen] = useState("");
  const locked = n.status !== "draft" || !canPublish;
  const set = (patch: Partial<typeof d>) => {
    setD({ ...d, ...patch });
    setDirty(true);
  };
  const issues = validateNewsletter(d);
  const preview = useMemo(
    () =>
      renderNewsletterEmail({
        draft: d,
        ctaUrl: d.ctaUrl || null,
        newsletterName: brand.name,
        accent: brand.accent,
        ink: brand.ink,
        mode: "test",
      }).html,
    [d, brand],
  );

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(t(done as "saved"));
        setDirty(false);
        router.refresh();
      } else toast.error(errorText(res.error ?? ""));
    });
  const save = () => saveNewsletter(channelId, n.id, d);
  const saveThen = (next: () => Promise<{ ok: boolean; error?: string }>) => async () => {
    if (dirty) {
      const r = await save();
      if (!r.ok) return r;
    }
    return next();
  };

  return (
    <div className="space-y-6" data-testid="newsletter-editor">
      {n.status !== "draft" ? (
        <p
          className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok"
          data-testid="newsletter-status"
        >
          {n.status === "scheduled"
            ? t("scheduledFor", { date: n.scheduledAt ?? "" })
            : t("sentOn", { date: n.sentAt ?? n.scheduledAt ?? "" })}
        </p>
      ) : null}
      <Card>
        <CardHeader title={t("weekOf", { date: n.weekStart })} />
        <CardBody>
          <fieldset disabled={locked || pending} className="space-y-4">
            <Field
              label={t("field.subject")}
              htmlFor="nl-subject"
              hint={<Counter value={len(d.subject)} max={L.subject} />}
            >
              <Input
                id="nl-subject"
                value={d.subject}
                maxLength={200}
                onChange={(e) => set({ subject: e.target.value })}
              />
            </Field>
            <Field
              label={t("field.preheader")}
              htmlFor="nl-preheader"
              hint={<Counter value={len(d.preheader)} max={L.preheader} />}
            >
              <Input
                id="nl-preheader"
                value={d.preheader}
                maxLength={300}
                onChange={(e) => set({ preheader: e.target.value })}
              />
            </Field>
            <Field
              label={t("field.point")}
              htmlFor="nl-point"
              hint={<Counter value={len(d.point)} max={L.point} />}
            >
              <Input
                id="nl-point"
                value={d.point}
                maxLength={400}
                onChange={(e) => set({ point: e.target.value })}
              />
            </Field>
            <Field
              label={t("field.body")}
              htmlFor="nl-body"
              hint={
                <Counter
                  value={newsletterWords(d.body)}
                  min={L.bodyMinWords}
                  max={L.bodyMaxWords}
                />
              }
            >
              <Textarea
                id="nl-body"
                value={d.body}
                maxLength={20000}
                className="min-h-80 font-mono text-[13px] leading-relaxed"
                onChange={(e) => set({ body: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted">{t("bodyHelp")}</p>
            </Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
              <Field
                label={t("field.cta")}
                htmlFor="nl-cta"
                hint={<Counter value={newsletterWords(d.ctaText)} max={L.ctaWords} />}
              >
                <Input
                  id="nl-cta"
                  value={d.ctaText}
                  maxLength={60}
                  onChange={(e) => set({ ctaText: e.target.value })}
                />
              </Field>
              <Field label={t("field.ctaUrl")} htmlFor="nl-cta-url">
                <Input
                  id="nl-cta-url"
                  type="url"
                  value={d.ctaUrl}
                  maxLength={500}
                  onChange={(e) => set({ ctaUrl: e.target.value.trim() })}
                />
              </Field>
            </div>
          </fieldset>
          {!locked && issues.length ? (
            <ul
              className="mt-4 space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"
              data-testid="newsletter-issues"
            >
              {issues.map((i) => (
                <li key={i}>{t(`issue.${i}`)}</li>
              ))}
            </ul>
          ) : null}
          {!locked ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !dirty}
                onClick={() => act(save, "saved")}
                data-testid="newsletter-save"
              >
                {t("save")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !canSend}
                onClick={() =>
                  act(
                    saveThen(() => sendNewsletterTest(channelId, n.id)),
                    "testSent",
                  )
                }
                data-testid="newsletter-test"
              >
                <TestTube2 className="size-3.5" /> {t("sendTest")}
              </Button>
              <Button
                size="sm"
                disabled={pending || !canSend || issues.length > 0}
                onClick={() => setConfirmOpen("now")}
                data-testid="newsletter-send"
              >
                <Send className="size-3.5" /> {t("sendNow")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !canSend || issues.length > 0}
                onClick={() => setConfirmOpen("schedule")}
                data-testid="newsletter-schedule"
              >
                <CalendarClock className="size-3.5" /> {t("schedule")}
              </Button>
              {pending ? <Loader2 className="size-4 animate-spin text-muted" /> : null}
              {n.testSentAt ? (
                <span className="text-xs text-muted">
                  {t("testSentAt", { date: n.testSentAt })}
                </span>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Eye className="size-4" /> {t("preview")}
            </span>
          }
        />
        <iframe
          title={t("preview")}
          srcDoc={preview}
          sandbox="allow-same-origin"
          className="h-[720px] w-full rounded-b-xl border-0 bg-white"
          data-testid="newsletter-preview"
        />
      </Card>
      <Dialog
        open={confirmOpen !== null}
        onClose={() => setConfirmOpen(null)}
        title={confirmOpen === "schedule" ? t("scheduleTitle") : t("sendTitle")}
      >
        <div className="space-y-4 text-sm">
          <p>{t("confirmText", { subject: d.subject })}</p>
          {!n.testSentAt ? <p className="text-warn">{t("noTestYet")}</p> : null}
          {confirmOpen === "schedule" ? (
            <Field label={t("when")} htmlFor="nl-when">
              <Input
                id="nl-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(null)}>
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              disabled={pending || (confirmOpen === "schedule" && !when)}
              data-testid="newsletter-confirm"
              onClick={() => {
                const scheduled =
                  confirmOpen === "schedule" && when ? new Date(when).toISOString() : null;
                setConfirmOpen(null);
                act(
                  saveThen(() => sendNewsletter(channelId, n.id, scheduled)),
                  scheduled ? "scheduled" : "sent",
                );
              }}
            >
              {confirmOpen === "schedule" ? t("confirmSchedule") : t("confirmSend")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
