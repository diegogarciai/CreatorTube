"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { setServiceBudget } from "@/lib/actions/admin";
import { useActionError } from "@/lib/use-action-error";

/** Presupuesto mensual de un servicio (en YouTube, % de la cuota diaria). */
export function BudgetForm({
  service,
  value,
}: {
  service: "ai" | "parallel" | "youtube" | "gemini";
  value: number | null;
}) {
  const t = useTranslations("usage");
  const tc = useTranslations("common");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs"
      action={(form) =>
        start(async () => {
          const res = await setServiceBudget(service, form.get("value"));
          if (res.ok) {
            toast.success(tc("saved"));
            router.refresh();
          } else toast.error(errorText(res.error));
        })
      }
    >
      <label className="flex items-center gap-1 text-muted">
        {service === "youtube" ? t("budgetPercent") : t("budgetUsd")}
        <Input
          name="value"
          type="number"
          min={0}
          step={service === "youtube" ? 1 : "0.01"}
          defaultValue={value ?? ""}
          placeholder={t("noBudget")}
          className="h-8 w-24"
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {tc("save")}
      </Button>
    </form>
  );
}
