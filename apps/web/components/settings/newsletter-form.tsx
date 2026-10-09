"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { updateNewsletterSettings } from "@/lib/actions/channels";
import { useActionError } from "@/lib/use-action-error";

export interface NewsletterSettings {
  newsletterName: string;
  senderName: string;
  senderEmail: string;
  segmentId: string;
}

/** El boletín del canal: nombre, remitente (dominio verificado en Resend) y segmento. */
export function NewsletterForm({
  channelId,
  initial,
  disabled,
}: {
  channelId: string;
  initial: NewsletterSettings;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const set = (patch: Partial<NewsletterSettings>) => setV({ ...v, ...patch });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateNewsletterSettings(channelId, v);
      if (res.ok) toast.success(t("common.saved"));
      else toast.error(errorText(res.error));
    });
  }

  return (
    <form onSubmit={submit} data-testid="newsletter-settings">
      <fieldset disabled={disabled || pending} className="grid gap-4 sm:grid-cols-2">
        <Field label={t("newsletterSettings.name")} htmlFor="nl-name">
          <Input
            id="nl-name"
            value={v.newsletterName}
            maxLength={80}
            placeholder="El Punto"
            onChange={(e) => set({ newsletterName: e.target.value })}
          />
        </Field>
        <Field label={t("newsletterSettings.segment")} htmlFor="nl-segment">
          <Input
            id="nl-segment"
            value={v.segmentId}
            maxLength={100}
            placeholder="202ab985-…"
            onChange={(e) => set({ segmentId: e.target.value.trim() })}
          />
        </Field>
        <Field label={t("newsletterSettings.senderName")} htmlFor="nl-sender-name">
          <Input
            id="nl-sender-name"
            value={v.senderName}
            maxLength={80}
            placeholder="Diego de Gartechs"
            onChange={(e) => set({ senderName: e.target.value })}
          />
        </Field>
        <Field
          label={t("newsletterSettings.senderEmail")}
          htmlFor="nl-sender-email"
          hint={t("newsletterSettings.senderEmailHint")}
        >
          <Input
            id="nl-sender-email"
            type="email"
            value={v.senderEmail}
            maxLength={200}
            placeholder="elpunto@gartechs.com"
            onChange={(e) => set({ senderEmail: e.target.value.trim() })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm">
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
