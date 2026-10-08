"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { setWorkspaceCredits } from "@/lib/actions/admin";
import { useActionError } from "@/lib/use-action-error";
import { cn, usd } from "@/lib/utils";

export function CreditsMeter({ monthly, used }: { monthly: number; used: number }) {
  const t = useTranslations("credits");
  const ratio = monthly > 0 ? Math.min(1, used / monthly) : 1;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {t("usedOf", { used: usd(used), monthly: usd(monthly) })}
        <span className="text-muted">
          {" "}
          · {t("remaining", { remaining: usd(Math.max(0, monthly - used)) })}
        </span>
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
        <div
          className={cn("h-full rounded-full", ratio >= 0.9 ? "bg-critical" : "bg-accent")}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

export function CreditsQuotaForm({
  workspaceId,
  monthly,
}: {
  workspaceId: string;
  monthly: number;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();
  return (
    <form
      action={(form) =>
        start(async () => {
          const res = await setWorkspaceCredits(workspaceId, form.get("usd"));
          if (res.ok) toast.success(t("common.saved"));
          else toast.error(errorText(res.error));
        })
      }
      className="flex items-center gap-2"
    >
      <span className="text-xs text-muted">{t("credits.quota")}</span>
      <Input
        name="usd"
        type="number"
        min={0}
        step={1}
        defaultValue={monthly / 100}
        aria-label={t("credits.quota")}
        className="h-8 w-24"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("common.save")}
      </Button>
    </form>
  );
}
