"use server";

import { revalidatePath } from "next/cache";
import { requireChannelPermission } from "../auth";
import { createAdminClient } from "../supabase/admin";
import { errorMessage, type ActionResult } from "../utils";
import { syncChannelById } from "../youtube";
import {
  ANALYTICS_COOLDOWN_MS,
  analyticsFetchedAt,
  syncAnalyticsById,
  syncReachById,
} from "../youtube-analytics";

/**
 * «Actualizar ahora» en Analítica: sincroniza los videos y trae la analítica
 * y el alcance del canal. No repite antes de 15 minutos (YouTube actualiza una vez al día).
 */
export async function refreshAnalytics(channelId: string): Promise<ActionResult> {
  try {
    await requireChannelPermission(channelId, "read");
    const admin = createAdminClient();
    const last = await analyticsFetchedAt(admin, channelId);
    if (last && Date.now() - last.getTime() < ANALYTICS_COOLDOWN_MS)
      return { ok: false, error: "errors.analytics_recent" };
    const synced = await syncChannelById(admin, channelId);
    if (!synced) return { ok: false, error: "errors.youtube_not_connected" };
    const res = await syncAnalyticsById(admin, channelId);
    if (!res) return { ok: false, error: "errors.youtube_not_connected" };
    if (!res.ok) return { ok: false, error: res.error ?? "errors.unknown" };
    // El alcance llega aparte (Reporting API): si falla, la analítica ya quedó.
    const reach = await syncReachById(admin, channelId);
    if (reach && !reach.ok) console.error("alcance", channelId, reach.error);
    revalidatePath(`/c/${channelId}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
