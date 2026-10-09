"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { SOCIAL_NETWORKS } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { updateSocials } from "@/lib/actions/channels";
import { useActionError } from "@/lib/use-action-error";

type Row = { label: string; url: string; other: boolean };

const OTHER = "__other";
const known = (label: string) => SOCIAL_NETWORKS.some((n) => n.label === label);

/**
 * Las redes del canal: de cada episodio salen 3 posts por red (Difusión).
 * El guion también las usa para la descripción.
 */
export function SocialsForm({
  channelId,
  initial,
  disabled,
}: {
  channelId: string;
  initial: { label: string; url: string }[];
  disabled?: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [rows, setRows] = useState<Row[]>(initial.map((r) => ({ ...r, other: !known(r.label) })));
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const unused = SOCIAL_NETWORKS.filter((n) => !rows.some((r) => r.label === n.label));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateSocials(
        channelId,
        rows.filter((r) => r.label.trim()).map(({ label, url }) => ({ label, url })),
      );
      if (res.ok) toast.success(t("common.saved"));
      else toast.error(errorText(res.error));
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="socials-form">
      <fieldset disabled={disabled || pending} className="space-y-3">
        {rows.length ? (
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label={t("socials.network")}
                  value={r.other ? OTHER : r.label}
                  onChange={(e) =>
                    set(
                      i,
                      e.target.value === OTHER
                        ? { other: true, label: "" }
                        : { other: false, label: e.target.value },
                    )
                  }
                  className="w-40"
                >
                  {SOCIAL_NETWORKS.filter(
                    (n) => n.label === r.label || !rows.some((x) => x.label === n.label),
                  ).map((n) => (
                    <option key={n.key} value={n.label}>
                      {n.label}
                    </option>
                  ))}
                  <option value={OTHER}>{t("socials.other")}</option>
                </Select>
                {r.other ? (
                  <Input
                    aria-label={t("socials.name")}
                    placeholder={t("socials.name")}
                    value={r.label}
                    maxLength={40}
                    onChange={(e) => set(i, { label: e.target.value })}
                    className="w-40"
                  />
                ) : null}
                <Input
                  aria-label={t("socials.url")}
                  placeholder="https://"
                  type="url"
                  value={r.url}
                  onChange={(e) => set(i, { url: e.target.value })}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t("socials.remove")}
                  onClick={() => setRows(rows.filter((_, k) => k !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("socials.none")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={rows.length >= 12}
            onClick={() =>
              setRows([
                ...rows,
                unused[0]
                  ? { label: unused[0].label, url: "", other: false }
                  : { label: "", url: "", other: true },
              ])
            }
            data-testid="add-social"
          >
            <Plus className="size-3.5" /> {t("socials.add")}
          </Button>
          <Button type="submit" size="sm">
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
