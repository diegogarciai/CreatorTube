"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, FolderDown, Loader2 } from "lucide-react";
import { strToU8, zipSync } from "fflate";
import { planToText } from "@planificador/core";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { VisualAidView } from "@/lib/data/visual-aids";
import type { ThumbnailDesignView } from "@/lib/data/thumbnails";
import {
  episodeResources,
  resourcesSummary,
  toVisualAid,
  zipEntries,
  type EpisodeResource,
  type ResourceStatus,
  type ResourceType,
} from "@/lib/resources";

const STATUS_TONE: Record<ResourceStatus, Tone> = {
  ready: "ok",
  outdated: "warn",
  rendering: "accent",
  queued: "neutral",
  failed: "critical",
  missing: "neutral",
  unchosen: "warn",
};

const TYPES: ResourceType[] = ["motion", "aid", "thumbnail"];

const size = (bytes: number | null) =>
  bytes === null
    ? null
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Recursos del episodio (Fase 3 · paso 5): los motion graphics, las ayudas y
 * la miniatura elegida, con su formato, archivo y estado, para que el editor
 * los baje uno a uno o todos en un .zip (se arma en el navegador).
 */
export function EpisodeResources({
  episodeCode,
  aids,
  designs,
}: {
  episodeCode: string;
  aids: VisualAidView[];
  designs: ThumbnailDesignView[];
}) {
  const t = useTranslations("resources");
  const rows = useMemo(
    () => episodeResources(episodeCode, aids, designs),
    [episodeCode, aids, designs],
  );
  const summary = resourcesSummary(rows);
  const entries = zipEntries(episodeCode, rows);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function downloadAll() {
    setProgress({ done: 0, total: entries.length });
    try {
      const files: Record<string, Uint8Array> = {};
      for (const [i, e] of entries.entries()) {
        const res = await fetch(e.url);
        if (!res.ok) throw new Error(String(res.status));
        files[e.path] = new Uint8Array(await res.arrayBuffer());
        setProgress({ done: i + 1, total: entries.length });
      }
      const approved = aids.filter((a) => a.status === "approved");
      if (approved.length) {
        files[`${episodeCode}-recursos/plan-de-ayudas.txt`] = strToU8(
          `${planToText(approved.map(toVisualAid))}\n`,
        );
      }
      // Sin comprimir: MP4, WebM y JPG ya van comprimidos.
      const data = zipSync(files, { level: 0 });
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${episodeCode}-recursos.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error(t("zipError"));
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card data-testid="episode-resources">
      <CardHeader
        title={t("title")}
        description={t("description")}
        action={
          <Button
            variant="secondary"
            onClick={downloadAll}
            disabled={!entries.length || progress !== null}
            data-testid="download-all"
          >
            {progress ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FolderDown className="size-4" />
            )}
            {progress
              ? t("zipProgress", { done: progress.done, total: progress.total })
              : t("downloadAll", { count: entries.length })}
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <p className="text-sm" data-testid="resources-summary">
          {summary.done
            ? t("allReady")
            : t("summary", { ready: summary.ready, total: summary.total })}
          {summary.counts.outdated ? (
            <span className="ml-2 text-warn">
              {t("outdatedHint", { count: summary.counts.outdated })}
            </span>
          ) : null}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">{t("col.resource")}</th>
                <th className="py-2 pr-3 font-medium">{t("col.format")}</th>
                <th className="py-2 pr-3 font-medium">{t("col.file")}</th>
                <th className="py-2 pr-3 font-medium">{t("col.status")}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            {TYPES.map((type) => {
              const group = rows.filter((r) => r.type === type);
              return (
                <tbody key={type} data-testid={`resources-${type}`}>
                  <tr>
                    <th
                      colSpan={5}
                      className="pt-4 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-muted"
                    >
                      {t(`type.${type}`)}
                    </th>
                  </tr>
                  {group.length ? (
                    group.map((r) => <ResourceRow key={r.key} row={r} />)
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-2 text-muted">
                        {t(`empty.${type}`)}
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
        <p className="text-xs text-muted">{t("soundNote")}</p>
      </CardBody>
    </Card>
  );
}

function ResourceRow({ row }: { row: EpisodeResource }) {
  const t = useTranslations("resources");
  return (
    <tr className="border-b border-border last:border-0" data-testid={`resource-${row.key}`}>
      <td className="py-2 pr-3">
        {row.code ? <span className="mr-2 font-mono text-xs">{row.code}</span> : null}
        <span className="line-clamp-1">
          {row.title || (row.status === "unchosen" ? t("noThumbnail") : "")}
        </span>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">{t(`format.${row.format}`)}</td>
      <td className="py-2 pr-3">
        {row.fileName ? (
          <span className="font-mono text-xs break-all">
            {row.fileName}
            {size(row.bytes) ? <span className="ml-2 text-muted">{size(row.bytes)}</span> : null}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <Badge tone={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
      </td>
      <td className="py-2 text-right">
        {row.downloadUrl ? (
          <a
            href={row.downloadUrl}
            className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-accent underline"
          >
            <Download className="size-3.5" /> {t("download")}
          </a>
        ) : null}
      </td>
    </tr>
  );
}
