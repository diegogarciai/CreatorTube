import "server-only";
import { cache } from "react";
import type { ChecklistStep } from "@planificador/core";
import { getSupabase } from "../auth";

export const getEpisodes = cache(async (channelId: string, includeArchived = false) => {
  const supabase = await getSupabase();
  let q = supabase.from("episodes").select("*").eq("channel_id", channelId);
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.order("board_position").order("number", { ascending: false });
  if (error) throw error;
  return data ?? [];
});

export const getPillars = cache(async (channelId: string, includeArchived = false) => {
  const supabase = await getSupabase();
  let q = supabase.from("pillars").select("*").eq("channel_id", channelId);
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.order("position");
  if (error) throw error;
  return data ?? [];
});

export const getChecklistSteps = cache(async (channelId: string): Promise<ChecklistStep[]> => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("checklist_steps").select("*").eq("channel_id", channelId).order("position");
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    phase: s.phase,
    position: s.position,
    archivedAt: s.archived_at ? new Date(s.archived_at) : null,
  }));
});

/** Pasos marcados por episodio, para mostrar el progreso en listas. */
export const getChecklistDone = cache(async (channelId: string) => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("episode_checklist_items").select("episode_id, step_id").eq("channel_id", channelId);
  if (error) throw error;
  const map = new Map<string, Set<string>>();
  for (const r of data ?? []) {
    if (!map.has(r.episode_id)) map.set(r.episode_id, new Set());
    map.get(r.episode_id)!.add(r.step_id);
  }
  return map;
});
