"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Package, Trash2 } from "lucide-react";
import {
  gearAgeMonths,
  gearLabel,
  loanDaysLeft,
  type GearOwnership,
  type GearStatus,
} from "@planificador/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteGear, setGearStatus } from "@/lib/actions/gear";
import type { GearView } from "@/lib/data/gear";
import { useActionError } from "@/lib/use-action-error";
import { GearDialog } from "./gear-dialog";

/** Un equipo del inventario, con sus acciones. */
export function GearCard({
  channelId,
  gear: g,
  today,
  canEdit,
}: {
  channelId: string;
  gear: GearView;
  today: string;
  canEdit: boolean;
}) {
  const t = useTranslations("gear");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const label = gearLabel(g);
  const months = gearAgeMonths(g.acquired_on, today);
  const days = loanDaysLeft(
    {
      ownership: g.ownership as GearOwnership,
      return_by: g.return_by,
      status: g.status as GearStatus,
    },
    today,
  );
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error ?? ""));
    });

  return (
    <li
      className="flex gap-3 rounded-xl border border-border bg-surface p-3"
      data-testid={`gear-${g.id}`}
    >
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted">
        {g.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
          <img src={g.photoUrl} alt={label} className="size-full object-cover" />
        ) : (
          <Package className="size-7 text-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium leading-tight">{label}</p>
        {label !== g.name ? <p className="text-xs text-muted">{g.name}</p> : null}
        <div className="flex flex-wrap gap-1">
          <Badge>{t(`category.${g.category}` as "category.other")}</Badge>
          {g.ownership !== "own" ? (
            <Badge tone="accent">{t(`ownership.${g.ownership}` as "ownership.own")}</Badge>
          ) : null}
          {days !== null ? (
            <Badge tone={days < 0 ? "critical" : days <= 10 ? "warn" : "neutral"}>
              {days < 0 ? t("returnLate", { days: -days }) : t("returnIn", { days })}
            </Badge>
          ) : null}
          {g.status === "retired" || g.status === "returned" ? (
            <Badge>{t(`status.${g.status}`)}</Badge>
          ) : null}
        </div>
        {months !== null ? (
          <p className="text-xs text-muted">{t("months", { count: months })}</p>
        ) : null}
        {g.notes ? <p className="line-clamp-2 text-xs text-muted">{g.notes}</p> : null}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            {g.status === "review" ? (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => act(() => setGearStatus(channelId, g.id, "active"))}
                data-testid={`confirm-gear-${g.id}`}
              >
                <Check className="size-3.5" /> {t("confirm")}
              </Button>
            ) : null}
            <GearDialog channelId={channelId} gear={g} />
            {g.status === "active" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  act(() =>
                    setGearStatus(channelId, g.id, g.ownership === "loan" ? "returned" : "retired"),
                  )
                }
              >
                {g.ownership === "loan" ? t("markReturned") : t("retire")}
              </Button>
            ) : g.status !== "review" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => act(() => setGearStatus(channelId, g.id, "active"))}
              >
                {t("reactivate")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              aria-label={g.status === "review" ? t("discard") : t("delete")}
              onClick={() =>
                (g.status === "review" || confirm(t("deleteConfirm", { name: label }))) &&
                act(() => deleteGear(channelId, g.id))
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
