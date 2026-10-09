"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { painToIdea } from "@/lib/actions/comments";
import { useActionError } from "@/lib/use-action-error";

/** «Pasar a Ideas»: crea una idea con origen «Dolor de la audiencia». */
export function PainToIdeaButton({
  channelId,
  episodeId,
  index,
}: {
  channelId: string;
  episodeId: string;
  index: number;
}) {
  const t = useTranslations("audience");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          const res = await painToIdea(channelId, episodeId, index);
          if (res.ok) {
            setDone(true);
            toast.success(t("ideaCreated"));
          } else toast.error(errorText(res.error));
        })
      }
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : done ? (
        <Check className="size-3.5" />
      ) : (
        <Lightbulb className="size-3.5" />
      )}
      {t("toIdea")}
    </Button>
  );
}
