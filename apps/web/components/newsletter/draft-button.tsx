"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftNewsletter } from "@/lib/actions/newsletter";
import { createClient } from "@/lib/supabase/browser";
import { NEWSLETTER_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";

/** «Redactar el boletín»: Claude lo escribe con lo publicado en la semana. */
export function DraftNewsletterButton({
  channelId,
  active,
  redo,
  variant = "secondary",
}: {
  channelId: string;
  active: boolean;
  /** Ya hay borrador: rehacerlo pisa lo editado. */
  redo?: boolean;
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("newsletter");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("tasks")
        .select("status")
        .eq("channel_id", channelId)
        .eq("kind", "newsletter")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status !== "queued" && data.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, supabase, channelId, router]);
  const busy = pending || active;
  return (
    <Button
      variant={variant}
      disabled={busy}
      title={t("estimate", { credits: NEWSLETTER_ESTIMATE_CREDITS })}
      onClick={() =>
        (!redo || confirm(t("redoConfirm"))) &&
        start(async () => {
          const res = await draftNewsletter(channelId);
          if (res.ok) {
            toast.success(t("draftStarted"));
            router.refresh();
          } else toast.error(errorText(res.error));
        })
      }
      data-testid="draft-newsletter"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {busy ? t("draftingShort") : redo ? t("redo") : t("draft")}
    </Button>
  );
}
