"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form";
import { pasteGearList } from "@/lib/actions/gear";
import { createClient } from "@/lib/supabase/browser";
import { GEAR_PARSE_ESTIMATE_CREDITS } from "@/lib/tasks";
import { useActionError } from "@/lib/use-action-error";

/** «Pegar una lista»: Claude la ordena y los equipos quedan por revisar. */
export function PasteGearList({ channelId, active }: { channelId: string; active: boolean }) {
  const t = useTranslations("gear");
  const tc = useTranslations("common");
  const errorText = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("tasks")
        .select("status")
        .eq("channel_id", channelId)
        .eq("kind", "gear_parse")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status !== "queued" && data.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, supabase, channelId, router]);
  const busy = pending || active;
  return (
    <>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => setOpen(true)}
        data-testid="paste-gear"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />}
        {busy ? t("parsing") : t("paste")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("paste")}>
        <div className="space-y-3 text-sm">
          <p className="text-muted">{t("pasteHint")}</p>
          <Textarea
            value={text}
            maxLength={8000}
            className="min-h-40"
            placeholder={'DJI Mini 4 Pro\nMacBook Air M3 15"\nAirPods Pro 2\nSony ZV-E10'}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("paste")}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {t("estimate", { credits: GEAR_PARSE_ESTIMATE_CREDITS })}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button
                disabled={pending || text.trim().length < 2}
                data-testid="paste-gear-submit"
                onClick={() =>
                  start(async () => {
                    const res = await pasteGearList(channelId, text);
                    if (res.ok) {
                      toast.success(t("parseStarted"));
                      setOpen(false);
                      setText("");
                      router.refresh();
                    } else toast.error(errorText(res.error));
                  })
                }
              >
                {t("parse")}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
