"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  can,
  channelProfileSchema,
  channelRhythmSchema,
  checklistStepSchema,
  pillarSchema,
  reorderSteps,
  type ChecklistStep,
} from "@planificador/core";
import { revokeToken } from "@planificador/youtube";
import { getMyMemberships, getSupabase, requireChannelPermission, requireUser } from "../auth";
import { createAdminClient } from "../supabase/admin";
import { decryptedToken, seedChannelDefaults, syncChannelById } from "../youtube";
import { errorMessage, type ActionResult } from "../utils";

function revalidateChannel(channelId: string) {
  revalidatePath(`/c/${channelId}`, "layout");
}

async function run(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Crea un canal sin conectarlo todavía a YouTube. */
export async function createManualChannel(workspaceId: string, formData: FormData) {
  await requireUser();
  const m = (await getMyMemberships()).find((x) => x.workspaceId === workspaceId);
  if (!m || !can(m.role, "configure_channel")) redirect("/onboarding?error=forbidden");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect(`/onboarding?workspace=${workspaceId}&error=name`);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("channels").insert({ workspace_id: workspaceId, name }).select("id").single();
  if (error) redirect(`/onboarding?workspace=${workspaceId}&error=create`);
  await seedChannelDefaults(createAdminClient(), data.id).catch(async () => {
    // Sin service role (entorno sin configurar): se siembra con la sesión.
    const { DEFAULT_CHECKLIST } = await import("@planificador/core");
    await supabase
      .from("checklist_steps")
      .insert(DEFAULT_CHECKLIST.map((s, i) => ({ channel_id: data.id, label: s.label, phase: s.phase, position: i })));
  });
  revalidatePath("/", "layout");
  redirect(`/onboarding/canal/${data.id}`);
}

export async function completeOnboarding(channelId: string) {
  await requireChannelPermission(channelId, "configure_channel");
  const supabase = await getSupabase();
  await supabase.from("channels").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", channelId);
  revalidatePath("/", "layout");
  redirect(`/c/${channelId}/inicio`);
}

export async function updateChannelProfile(channelId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const p = channelProfileSchema.parse(input);
    const supabase = await getSupabase();
    const { data: current } = await supabase.from("channels").select("profile").eq("id", channelId).single();
    const { error } = await supabase
      .from("channels")
      .update({
        name: p.name,
        language: p.language,
        timezone: p.timezone,
        code_prefix: p.codePrefix,
        profile: { ...((current?.profile as object) ?? {}), hosts: p.hosts, audience: p.audience, tone: p.tone },
      })
      .eq("id", channelId);
    if (error) throw error;
    revalidatePath("/", "layout");
  });
}

export async function updateChannelRhythm(channelId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const r = channelRhythmSchema.parse(input);
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("channels")
      .update({
        weekly_goal: r.weeklyGoal,
        publish_weekdays: [...new Set(r.publishWeekdays)].sort(),
        record_weekdays: [...new Set(r.recordWeekdays)].sort(),
        formats: r.formats,
      })
      .eq("id", channelId);
    if (error) throw error;
    revalidateChannel(channelId);
  });
}

export async function addPillar(channelId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const p = pillarSchema.parse(input);
    const supabase = await getSupabase();
    const { count } = await supabase.from("pillars").select("id", { count: "exact", head: true }).eq("channel_id", channelId);
    const { error } = await supabase.from("pillars").insert({ channel_id: channelId, ...p, position: count ?? 0 });
    if (error) throw error;
    revalidateChannel(channelId);
  });
}

export async function updatePillar(channelId: string, pillarId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const p = pillarSchema.parse(input);
    const supabase = await getSupabase();
    const { error } = await supabase.from("pillars").update(p).eq("id", pillarId).eq("channel_id", channelId);
    if (error) throw error;
    revalidateChannel(channelId);
  });
}

export async function setPillarArchived(channelId: string, pillarId: string, archived: boolean): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("pillars")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", pillarId)
      .eq("channel_id", channelId);
    if (error) throw error;
    revalidateChannel(channelId);
  });
}

export async function addChecklistStep(channelId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const s = checklistStepSchema.parse(input);
    const supabase = await getSupabase();
    const { data: last } = await supabase
      .from("checklist_steps")
      .select("position")
      .eq("channel_id", channelId)
      .eq("phase", s.phase)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from("checklist_steps")
      .insert({ channel_id: channelId, label: s.label, phase: s.phase, position: (last?.position ?? -1) + 1 });
    if (error) throw error;
    revalidateChannel(channelId);
  });
}

/** Renombrar conserva el identificador: los episodios no se desmarcan. */
export async function renameChecklistStep(channelId: string, stepId: string, label: string): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const parsed = checklistStepSchema.shape.label.parse(label);
    const supabase = await getSupabase();
    const { error } = await supabase.from("checklist_steps").update({ label: parsed }).eq("id", stepId).eq("channel_id", channelId);
    if (error) throw error;
    revalidateChannel(channelId);
  });
}

export async function moveChecklistStep(channelId: string, stepId: string, toIndex: number): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const supabase = await getSupabase();
    const { data, error } = await supabase.from("checklist_steps").select("*").eq("channel_id", channelId);
    if (error) throw error;
    const steps: ChecklistStep[] = (data ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      phase: s.phase,
      position: s.position,
      archivedAt: s.archived_at ? new Date(s.archived_at) : null,
    }));
    for (const { id, position } of reorderSteps(steps, stepId, toIndex)) {
      const { error: e } = await supabase.from("checklist_steps").update({ position }).eq("id", id);
      if (e) throw e;
    }
    revalidateChannel(channelId);
  });
}

export async function setChecklistStepArchived(channelId: string, stepId: string, archived: boolean): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "configure_channel");
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("checklist_steps")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", stepId)
      .eq("channel_id", channelId);
    if (error) throw error;
    revalidateChannel(channelId);
  });
}

export async function regenerateIcsToken(channelId: string): Promise<ActionResult> {
  return run(async () => {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("regenerate_ics_token", { ch: channelId });
    if (error) throw error;
    revalidateChannel(channelId);
  });
}

export async function syncChannelNow(channelId: string): Promise<ActionResult<{ videos: number; advanced: number }>> {
  try {
    await requireChannelPermission(channelId, "configure_channel");
    const result = await syncChannelById(createAdminClient(), channelId);
    if (!result) return { ok: false, error: "errors.not_found" };
    if (!result.ok) return { ok: false, error: result.error ?? "errors.unknown" };
    revalidateChannel(channelId);
    return { ok: true, data: { videos: result.videos, advanced: result.advanced } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Desconexión limpia: revoca el token con Google, borra la conexión y los
 * datos de YouTube del canal. La planificación del canal se conserva.
 */
export async function disconnectYouTube(channelId: string): Promise<ActionResult> {
  return run(async () => {
    await requireChannelPermission(channelId, "manage_workspace");
    const admin = createAdminClient();
    const token = await decryptedToken(admin, channelId, "revocable").catch(() => null);
    if (token) await revokeToken(token).catch(() => false);
    await admin.from("channel_connections").delete().eq("channel_id", channelId);
    await admin.from("youtube_video_daily_stats").delete().eq("channel_id", channelId);
    await admin.from("youtube_videos").delete().eq("channel_id", channelId);
    const { error } = await admin
      .from("channels")
      .update({ disconnected_at: new Date().toISOString(), youtube_channel_id: null })
      .eq("id", channelId);
    if (error) throw error;
    revalidateChannel(channelId);
  });
}
