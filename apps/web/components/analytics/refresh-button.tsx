"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshAnalytics } from "@/lib/actions/analytics";
import { useActionError } from "@/lib/use-action-error";

/** «Actualizar ahora»: trae la analítica del canal sin esperar al cron diario. */
export function RefreshAnalyticsButton({ channelId }: { channelId: string }) {
  const t = useTranslations("analytics");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      data-testid="refresh-analytics"
      onClick={() =>
        start(async () => {
          const res = await refreshAnalytics(channelId);
          if (res.ok) {
            toast.success(t("refreshed"));
            router.refresh();
          } else toast.error(errorText(res.error));
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {t("refresh")}
    </Button>
  );
}
