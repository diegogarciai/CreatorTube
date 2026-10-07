"use server";

import { revalidatePath } from "next/cache";
import { IDEA_STATUSES, ideaSchema, type IdeaStatus } from "@planificador/core";
import { getSupabase, requireChannelPermission } from "../auth";
import { errorMessage, type ActionResult } from "../utils";

export async function createIdea(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const p = ideaSchema.parse(input);
    const ctx = await requireChannelPermission(p.channelId, "write_script");
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("ideas")
      .insert({
        channel_id: p.channelId,
        title: p.title,
        notes: p.notes,
        origin: p.origin,
        status: p.status,
        signals: p.signals,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath(`/c/${p.channelId}/ideas`);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateIdea(ideaId: string, input: unknown): Promise<ActionResult> {
  try {
    const p = ideaSchema.parse(input);
    await requireChannelPermission(p.channelId, "write_script");
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("ideas")
      .update({
        title: p.title,
        notes: p.notes,
        origin: p.origin,
        status: p.status,
        signals: p.signals,
      })
      .eq("id", ideaId)
      .eq("channel_id", p.channelId);
    if (error) throw error;
    revalidatePath(`/c/${p.channelId}/ideas`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setIdeaStatus(
  channelId: string,
  ideaId: string,
  status: IdeaStatus,
): Promise<ActionResult> {
  try {
    if (!IDEA_STATUSES.includes(status)) throw new Error("errors.invalid_input");
    await requireChannelPermission(channelId, "write_script");
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("ideas")
      .update({ status })
      .eq("id", ideaId)
      .eq("channel_id", channelId);
    if (error) throw error;
    revalidatePath(`/c/${channelId}/ideas`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
