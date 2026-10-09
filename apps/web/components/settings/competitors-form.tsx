"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { addCompetitor, removeCompetitor } from "@/lib/actions/competitors";
import type { CompetitorView } from "@/lib/data/competitors";
import { useActionError } from "@/lib/use-action-error";

const int = new Intl.NumberFormat("es-CO");

/** Los canales que sigue el canal: de sus videos atípicos salen ideas. */
export function CompetitorsForm({
  channelId,
  competitors,
  disabled,
}: {
  channelId: string;
  competitors: CompetitorView[];
  disabled?: boolean;
}) {
  const t = useTranslations("competitors");
  const errorText = useActionError();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (done) toast.success(done);
        router.refresh();
      } else toast.error(errorText(res.error ?? "errors.unknown"));
    });
  return (
    <div className="space-y-4 text-sm" data-testid="competitors-form">
      {competitors.length ? (
        <ul className="divide-y divide-border">
          {competitors.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              {c.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnailUrl} alt="" className="size-8 rounded-full" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.title ?? t("pendingTitle")}</p>
                <p className="text-xs text-muted">
                  {[
                    c.handle,
                    c.medianViews !== null
                      ? t("median", { views: int.format(Math.round(c.medianViews)) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <a
                href={`https://www.youtube.com/channel/${c.youtubeChannelId}`}
                target="_blank"
                rel="noreferrer"
                className="text-muted hover:text-text"
                aria-label={t("open")}
              >
                <ExternalLink className="size-4" />
              </a>
              {!disabled ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("remove")}
                  disabled={pending}
                  onClick={() => run(() => removeCompetitor(channelId, c.id))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t("none")}</p>
      )}
      {!disabled ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await addCompetitor(channelId, value);
              if (res.ok) {
                setValue("");
                toast.success(t("added", { title: res.data.title }));
              }
              return res.ok ? { ok: true } : res;
            });
          }}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            className="min-w-60 flex-1"
            disabled={pending}
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending || !value.trim()}
            data-testid="add-competitor"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {t("add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
