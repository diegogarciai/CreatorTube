"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { disconnectYouTube, regenerateIcsToken, syncChannelNow } from "@/lib/actions/channels";
import { useActionError } from "@/lib/use-action-error";

type Status = "active" | "needs_reauth" | "revoked" | null;
const TONE: Record<string, Tone> = {
  active: "ok",
  needs_reauth: "critical",
  revoked: "neutral",
  none: "neutral",
};
const LABEL: Record<string, string> = {
  active: "connected",
  needs_reauth: "needsReauth",
  revoked: "revoked",
  none: "notConnected",
};

export function ConnectionPanel({
  channelId,
  status,
  lastSync,
  lastError,
  youtubeConfigured,
  canConfigure,
  canDisconnect,
  canReply = false,
}: {
  channelId: string;
  status: Status;
  lastSync: string | null;
  lastError: string | null;
  youtubeConfigured: boolean;
  canConfigure: boolean;
  canDisconnect: boolean;
  /** El canal ya dio el permiso para responder comentarios. */
  canReply?: boolean;
}) {
  const t = useTranslations("settings");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const key = status ?? "none";

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={TONE[key]}>{t(LABEL[key]!)}</Badge>
        <span className="text-muted">
          {lastSync ? t("lastSync", { date: lastSync }) : t("neverSynced")}
        </span>
      </div>
      {status === "active" ? (
        <p className="text-xs text-muted">
          {canReply ? t("repliesEnabled") : t("repliesDisabled")}
        </p>
      ) : null}
      {lastError ? (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">{lastError}</p>
      ) : null}
      {canConfigure ? (
        <div className="flex flex-wrap gap-2">
          {youtubeConfigured ? (
            <a
              href={`/api/youtube/connect?channel=${channelId}`}
              className={buttonClass(status === "active" ? "secondary" : "primary", "sm")}
            >
              {status ? t("reconnect") : t("connect")}
            </a>
          ) : null}
          {youtubeConfigured && status === "active" && !canReply ? (
            <a
              href={`/api/youtube/connect?channel=${channelId}&scope=comments`}
              className={buttonClass("secondary", "sm")}
              data-testid="enable-replies"
            >
              {t("enableReplies")}
            </a>
          ) : null}
          {status === "active" ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await syncChannelNow(channelId);
                  if (res.ok) toast.success(t("syncResult", res.data));
                  else toast.error(errorText(res.error));
                })
              }
            >
              <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} /> {t("syncNow")}
            </Button>
          ) : null}
          {status && canDisconnect ? (
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (!confirm(t("disconnectConfirm"))) return;
                start(async () => {
                  const res = await disconnectYouTube(channelId);
                  if (!res.ok) toast.error(errorText(res.error));
                });
              }}
            >
              {t("disconnect")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RegenerateIcsButton({ channelId }: { channelId: string }) {
  const t = useTranslations("settings");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(t("regenerateConfirm"))) return;
        start(async () => {
          const res = await regenerateIcsToken(channelId);
          if (!res.ok) toast.error(errorText(res.error));
        });
      }}
    >
      <RefreshCw className="size-4" /> {t("regenerate")}
    </Button>
  );
}
