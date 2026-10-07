"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/form";

export function CopyField({ value, label }: { value: string; label?: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.target.select()}
        className="font-mono text-xs"
      />
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}
