"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImagePlus, Package, Plus, X } from "lucide-react";
import { GEAR_ROLES, type GearRole } from "@planificador/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { gearPhotoToEpisodeRef, linkEpisodeGear, unlinkEpisodeGear } from "@/lib/actions/gear";
import type { LinkedGear } from "@/lib/data/gear";
import { useActionError } from "@/lib/use-action-error";

/** «Equipo del episodio»: qué protagoniza el video y con qué se grabó. */
export function EpisodeGearCard({
  channelId,
  episodeId,
  linked,
  options,
  canEdit,
}: {
  channelId: string;
  episodeId: string;
  linked: LinkedGear[];
  options: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const t = useTranslations("gear");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<GearRole>("protagonist");
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (done) toast.success(t(done as "added"));
        router.refresh();
      } else toast.error(errorText(res.error ?? ""));
    });

  return (
    <Card data-testid="episode-gear">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Package className="size-4" /> {t("episodeTitle")}
          </span>
        }
        description={t("episodeDesc")}
      />
      <CardBody className="space-y-3 text-sm">
        {linked.length ? (
          <ul className="space-y-2">
            {linked.map((g) => (
              <li key={g.gearId} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 font-medium">{g.label}</span>
                {g.ownership !== "own" ? (
                  <Badge tone="accent">{t(`ownership.${g.ownership}`)}</Badge>
                ) : null}
                {canEdit ? (
                  <>
                    <Select
                      aria-label={t("role")}
                      value={g.role}
                      disabled={pending}
                      className="h-8 w-36 text-xs"
                      onChange={(e) =>
                        act(() => linkEpisodeGear(episodeId, g.gearId, e.target.value))
                      }
                    >
                      {GEAR_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`roleValue.${r}`)}
                        </option>
                      ))}
                    </Select>
                    {g.role === "protagonist" && g.hasPhoto ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        title={t("photoToRef")}
                        aria-label={t("photoToRef")}
                        onClick={() =>
                          act(() => gearPhotoToEpisodeRef(episodeId, g.gearId), "photoToRefDone")
                        }
                      >
                        <ImagePlus className="size-3.5" />
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={t("unlink")}
                      onClick={() => act(() => unlinkEpisodeGear(episodeId, g.gearId))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <Badge>{t(`roleValue.${g.role}`)}</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("episodeNone")}</p>
        )}
        {canEdit && options.length ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Select
              aria-label={t("pickGear")}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-8 min-w-0 flex-1 text-xs"
            >
              <option value="">{t("pickGear")}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("role")}
              value={role}
              onChange={(e) => setRole(e.target.value as GearRole)}
              className="h-8 w-36 text-xs"
            >
              {GEAR_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roleValue.${r}`)}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !pick}
              data-testid="link-gear"
              onClick={() => {
                const id = pick;
                setPick("");
                act(() => linkEpisodeGear(episodeId, id, role));
              }}
            >
              <Plus className="size-3.5" /> {t("link")}
            </Button>
          </div>
        ) : canEdit && !linked.length ? (
          <a href={`/c/${channelId}/equipo`} className="text-xs text-accent hover:underline">
            {t("goToGear")}
          </a>
        ) : null}
      </CardBody>
    </Card>
  );
}
