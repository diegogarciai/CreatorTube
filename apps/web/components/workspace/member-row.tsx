"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Role } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { removeMember, updateMember } from "@/lib/actions/members";
import { revokeInvitation } from "@/lib/actions/invitations";
import { useActionError } from "@/lib/use-action-error";

export function MemberControls({
  workspaceId,
  userId,
  role,
  channelIds,
  assignable,
}: {
  workspaceId: string;
  userId: string;
  role: Role;
  channelIds: string[] | null;
  assignable: Role[];
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();
  if (!assignable.includes(role))
    return <span className="text-sm text-muted">{t(`role.${role}`)}</span>;
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label={t("workspace.role")}
        className="h-8 w-auto"
        value={role}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const res = await updateMember(workspaceId, userId, {
              role: e.target.value as Role,
              channelIds,
            });
            if (!res.ok) toast.error(errorText(res.error));
          })
        }
      >
        {assignable.map((r) => (
          <option key={r} value={r}>
            {t(`role.${r}`)}
          </option>
        ))}
      </Select>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await removeMember(workspaceId, userId);
            if (!res.ok) toast.error(errorText(res.error));
          })
        }
      >
        {t("workspace.remove")}
      </Button>
    </div>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations("workspace");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await revokeInvitation(invitationId);
          if (!res.ok) toast.error(errorText(res.error));
        })
      }
    >
      {t("revoke")}
    </Button>
  );
}
