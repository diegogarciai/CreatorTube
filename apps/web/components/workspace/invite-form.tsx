"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Role } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { CopyField } from "@/components/copy-field";
import { inviteCreator, inviteMember } from "@/lib/actions/invitations";
import { useActionError } from "@/lib/use-action-error";

export function InviteForm({
  workspaceId,
  roles,
  channels,
}: {
  workspaceId?: string;
  roles?: Role[];
  channels?: { id: string; name: string }[];
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  function submit(form: FormData) {
    start(async () => {
      const email = String(form.get("email") ?? "");
      const res = workspaceId
        ? await inviteMember(workspaceId, {
            email,
            role: String(form.get("role")),
            channelIds: selected.length ? selected : null,
          })
        : await inviteCreator({ email });
      if (!res.ok) toast.error(errorText(res.error));
      else setLink(res.data.link);
    });
  }

  return (
    <div className="space-y-4">
      <form action={submit} className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Field label={t("workspace.email")} htmlFor="inv-email">
          <Input id="inv-email" name="email" type="email" required />
        </Field>
        {roles ? (
          <Field label={t("workspace.role")} htmlFor="inv-role">
            <Select id="inv-role" name="role" defaultValue="producer">
              {roles
                .filter((r) => r !== "owner")
                .map((r) => (
                  <option key={r} value={r} title={t(`roleDescription.${r}`)}>
                    {t(`role.${r}`)}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        <Button type="submit" disabled={pending}>
          {t("workspace.createInvite")}
        </Button>
        {channels && channels.length > 1 ? (
          <fieldset className="sm:col-span-3">
            <legend className="mb-1.5 text-sm font-medium">{t("workspace.channels")}</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-muted">
                {selected.length === 0 ? t("workspace.allChannels") : null}
              </span>
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </form>
      {link ? (
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("workspace.inviteLink")}</p>
          <CopyField value={link} />
        </div>
      ) : null}
    </div>
  );
}
