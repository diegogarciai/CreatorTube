"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { addPillar, setPillarArchived, updatePillar } from "@/lib/actions/channels";
import { useActionError } from "@/lib/use-action-error";

interface Pillar {
  id: string;
  name: string;
  description: string;
  color: string;
  archived: boolean;
}

export function PillarsEditor({
  channelId,
  pillars,
  disabled,
}: {
  channelId: string;
  pillars: Pillar[];
  disabled: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#ea580c");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(errorText(res.error ?? "errors.unknown"));
      else after?.();
    });

  return (
    <div className="space-y-3">
      {pillars.length === 0 ? (
        <p className="text-sm text-muted">{t("settings.noPillars")}</p>
      ) : null}
      <ul className="space-y-2">
        {pillars.map((p) => (
          <li key={p.id} className={`flex items-center gap-2 ${p.archived ? "opacity-50" : ""}`}>
            <input
              type="color"
              defaultValue={p.color}
              disabled={disabled || p.archived}
              aria-label={t("settings.pillarColor")}
              className="size-9 shrink-0 cursor-pointer rounded border border-border bg-surface"
              onBlur={(e) =>
                e.target.value !== p.color &&
                run(() =>
                  updatePillar(channelId, p.id, {
                    name: p.name,
                    description: p.description,
                    color: e.target.value,
                  }),
                )
              }
            />
            <Input
              defaultValue={p.name}
              disabled={disabled || p.archived}
              aria-label={t("settings.pillarName")}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== p.name)
                  run(() =>
                    updatePillar(channelId, p.id, {
                      name: v,
                      description: p.description,
                      color: p.color,
                    }),
                  );
              }}
            />
            {!disabled ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => setPillarArchived(channelId, p.id, !p.archived))}
                aria-label={p.archived ? t("common.restore") : t("common.archive")}
              >
                {p.archived ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {!disabled ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => addPillar(channelId, { name, color, description: "" }),
              () => setName(""),
            );
          }}
        >
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label={t("settings.pillarColor")}
            className="size-9 shrink-0 cursor-pointer rounded border border-border bg-surface"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("settings.pillarName")}
            required
            maxLength={80}
          />
          <Button type="submit" variant="secondary" disabled={pending}>
            <Plus className="size-4" /> {t("common.add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
