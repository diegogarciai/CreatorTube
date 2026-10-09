"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

/** Mientras se redacta un boletín, refresca la página cuando la tarea termina. */
export function useNewsletterTaskWatch(
  channelId: string,
  episodeId: string | null,
  active: boolean,
) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const q = supabase
        .from("tasks")
        .select("status")
        .eq("channel_id", channelId)
        .eq("kind", "newsletter");
      const { data } = await (episodeId ? q.eq("episode_id", episodeId) : q.is("episode_id", null))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && data.status !== "queued" && data.status !== "running") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, supabase, channelId, episodeId, router]);
}
