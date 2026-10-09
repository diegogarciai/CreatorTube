"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";

/** El bloque de equipo listo para pegar al final de la descripción de YouTube. */
export function GearDescriptionBlock({ text }: { text: string }) {
  const t = useTranslations("gear");
  const [copied, setCopied] = useState(false);
  return (
    <Card data-testid="gear-description">
      <CardHeader
        title={t("descriptionTitle")}
        description={t("descriptionDesc")}
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? t("copied") : t("copy")}
          </Button>
        }
      />
      <CardBody>
        <Textarea readOnly value={text} className="min-h-40 font-mono text-xs" />
      </CardBody>
    </Card>
  );
}
