"use server";

import { getSupabase, requireUser } from "../auth";

export interface CommandEpisode {
  id: string;
  channelId: string;
  title: string;
  code: string;
  number: number;
}

/** Índice para la barra de comandos (Ctrl+K): episodios activos visibles. */
export async function commandIndex(): Promise<CommandEpisode[]> {
  await requireUser();
  const supabase = await getSupabase();
  const { data } = await supabase
    .from("episodes")
    .select("id, channel_id, title, code, number")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(300);
  return (data ?? []).map((e) => ({ id: e.id, channelId: e.channel_id, title: e.title, code: e.code, number: e.number }));
}
