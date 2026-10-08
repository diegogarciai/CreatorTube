"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { testJobEngine } from "@/lib/actions/admin";
import { useActionError } from "@/lib/use-action-error";

export function JobTestButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("admin");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const res = await testJobEngine();
          if (res.ok) toast.success(t("jobsStarted"));
          else toast.error(errorText(res.error));
        })
      }
    >
      {t("jobsTest")}
    </Button>
  );
}
