"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Botón pequeño para copiar un texto (no marca el check si va dentro de un label). */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={label ?? t("copy")}
      title={copied ? t("copied") : t("copy")}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted hover:text-text",
        className,
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? t("copied") : t("copy")}
    </button>
  );
}
