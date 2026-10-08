"use client";

import { useTranslations } from "next-intl";
import type { ThumbnailOptions } from "@planificador/core";
import { cn } from "@/lib/utils";

const KEYS = ["noText", "noPerson", "noProduct"] as const;

/** Los tres checks de una miniatura: sin texto, sin persona y sin producto. */
export function ThumbnailOptionChecks({
  value,
  onChange,
  letter,
  className,
}: {
  value: ThumbnailOptions;
  onChange: (next: ThumbnailOptions) => void;
  /** La tarjeta (A, B o C), para que cada check tenga su nombre. */
  letter: string;
  className?: string;
}) {
  const t = useTranslations("thumbnails.options");
  return (
    <div
      role="group"
      aria-label={t("group", { letter })}
      className={cn("flex flex-wrap items-center gap-3 text-xs", className)}
    >
      {KEYS.map((key) => (
        <label key={key} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            aria-label={`${t(key)} (${letter})`}
          />
          {t(key)}
        </label>
      ))}
    </div>
  );
}

/** Las insignias de lo que se quitó de una versión. */
export function optionLabels(value: ThumbnailOptions) {
  return KEYS.filter((k) => value[k]);
}
