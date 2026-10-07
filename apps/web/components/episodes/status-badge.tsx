import { useTranslations } from "next-intl";
import type { EpisodeStatus } from "@planificador/core";
import { Badge, type Tone } from "@/components/ui/badge";

export const STATUS_TONE: Record<EpisodeStatus, Tone> = {
  planned: "neutral",
  script: "accent",
  to_record: "warn",
  editing: "warn",
  scheduled: "ok",
  published: "ok",
};

export function StatusBadge({ status }: { status: EpisodeStatus }) {
  const t = useTranslations("status");
  return <Badge tone={STATUS_TONE[status]}>{t(status)}</Badge>;
}
