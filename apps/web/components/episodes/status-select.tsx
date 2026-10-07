"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  canChangeStatus,
  EPISODE_STATUSES,
  type EpisodeStatus,
  type Role,
} from "@planificador/core";
import { Select } from "@/components/ui/form";
import { changeEpisodeStatus } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";

export function StatusSelect({
  episodeId,
  status,
  role,
}: {
  episodeId: string;
  status: EpisodeStatus;
  role: Role;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const options = EPISODE_STATUSES.filter((s) => canChangeStatus(role, status, s));
  return (
    <Select
      aria-label={t("episode.status")}
      value={status}
      disabled={pending || options.length <= 1}
      className="h-9 w-auto"
      onChange={(e) =>
        start(async () => {
          const res = await changeEpisodeStatus(episodeId, e.target.value as EpisodeStatus);
          if (!res.ok) toast.error(errorText(res.error));
        })
      }
    >
      {options.map((s) => (
        <option key={s} value={s}>
          {t(`status.${s}`)}
        </option>
      ))}
    </Select>
  );
}
