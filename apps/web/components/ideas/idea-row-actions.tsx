"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { IdeaStatus } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { setIdeaStatus } from "@/lib/actions/ideas";
import { useActionError } from "@/lib/use-action-error";
import { IdeaDialog, type IdeaValues } from "./idea-dialog";

export function IdeaRowActions({
  channelId,
  idea,
  canWrite,
}: {
  channelId: string;
  idea: IdeaValues & { id: string };
  canWrite: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();
  if (!canWrite) return null;
  const setStatus = (status: IdeaStatus) =>
    start(async () => {
      const res = await setIdeaStatus(channelId, idea.id, status);
      if (!res.ok) toast.error(errorText(res.error));
    });
  return (
    <>
      <IdeaDialog
        channelId={channelId}
        initial={idea}
        trigger={(open) => (
          <Button variant="ghost" size="sm" onClick={open}>
            {t("common.edit")}
          </Button>
        )}
      />
      {idea.status === "discarded" ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setStatus("new")}>
          {t("common.restore")}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setStatus("discarded")}>
          {t("ideas.discard")}
        </Button>
      )}
    </>
  );
}

export function NewIdeaButton({ channelId }: { channelId: string }) {
  const t = useTranslations("ideas");
  return (
    <IdeaDialog
      channelId={channelId}
      trigger={(open) => <Button onClick={open}>{t("new")}</Button>}
    />
  );
}
