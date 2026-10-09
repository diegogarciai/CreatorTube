"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { commentToIdea, readingToIdea } from "@/lib/actions/comments";
import { useActionError } from "@/lib/use-action-error";

export type IdeaSource =
  | { episodeId: string; index: number; kind: "pain" | "idea" }
  | { commentId: string };

/**
 * «Pasar a Ideas» desde la audiencia: un dolor o una idea de la lectura de
 * comentarios, o un comentario que pide un tema.
 */
export function ToIdeaButton({ channelId, source }: { channelId: string; source: IdeaSource }) {
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
          const res =
            "commentId" in source
              ? await commentToIdea(channelId, source.commentId)
              : await readingToIdea(channelId, source.episodeId, source.index, source.kind);
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
