"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { suggestIdeas } from "@/lib/actions/ideas";
import { createClient } from "@/lib/supabase/browser";
import { IDEAS_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";

/**
 * «Proponer ideas»: Claude cruza búsquedas, comentarios, competencia,
 * evaluaciones y noticias del nicho, y deja ideas sugeridas en el banco.
 */
export function SuggestIdeasButton({
  channelId,
  active,
  variant = "secondary",
}: {
  channelId: string;
  /** Hay una tanda en marcha. */
  active: boolean;
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("ideas");
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
        .eq("kind", "idea_suggestions")
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
      title={t("suggestEstimate", { credits: IDEAS_ESTIMATE_CREDITS })}
      onClick={() =>
        start(async () => {
          const res = await suggestIdeas(channelId);
          if (res.ok) {
            toast.success(t("suggestStarted"));
            router.refresh();
          } else toast.error(errorText(res.error));
        })
      }
      data-testid="suggest-ideas"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {busy ? t("suggesting") : t("suggest")}
    </Button>
  );
}
