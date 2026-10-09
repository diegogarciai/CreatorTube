"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ExternalLink, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { competitorVideoToIdea } from "@/lib/actions/competitors";
import type { OutlierView } from "@/lib/data/competitors";
import { useActionError } from "@/lib/use-action-error";

const int = new Intl.NumberFormat("es-CO");
const ratioFmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

/** Atípicos de la competencia: videos que superan varias veces la mediana de su canal. */
export function OutliersCard({
  channelId,
  outliers,
  hasCompetitors,
  canIdea,
  canConfigure,
}: {
  channelId: string;
  outliers: OutlierView[];
  hasCompetitors: boolean;
  canIdea: boolean;
  canConfigure: boolean;
}) {
  const t = useTranslations("competitors");
  return (
    <Card data-testid="outliers">
      <CardHeader title={t("outliersTitle")} description={t("outliersDesc")} />
      {outliers.length ? (
        <ul className="divide-y divide-border">
          {outliers.map((o) => (
            <li
              key={`${o.competitorId}-${o.videoId}`}
              className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
              data-testid={`outlier-${o.videoId}`}
            >
              {o.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={o.thumbnailUrl}
                  alt=""
                  className="h-12 w-20 shrink-0 rounded object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <a
                  href={`https://youtu.be/${o.videoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                >
                  {o.title} <ExternalLink className="size-3 text-muted" />
                </a>
                <p className="text-xs text-muted">
                  {o.channelTitle} · {t("views", { views: int.format(o.views) })}
                </p>
              </div>
              <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok tabular-nums">
                ×{ratioFmt.format(o.ratio)}
              </span>
              {canIdea ? <OutlierToIdea channelId={channelId} outlier={o} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-muted">
          {hasCompetitors ? t("noOutliers") : t("noCompetitors")}{" "}
          {!hasCompetitors && canConfigure ? (
            <Link href={`/c/${channelId}/ajustes`} className="text-accent underline">
              {t("toSettings")}
            </Link>
          ) : null}
        </p>
      )}
    </Card>
  );
}

function OutlierToIdea({ channelId, outlier }: { channelId: string; outlier: OutlierView }) {
  const t = useTranslations("competitors");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(outlier.inIdeas);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          const res = await competitorVideoToIdea(channelId, outlier.competitorId, outlier.videoId);
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
      {done ? t("inIdeas") : t("toIdea")}
    </Button>
  );
}
