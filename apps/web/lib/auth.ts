import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { canOnChannel, type Permission, type Role } from "@planificador/core";
import type { Tables } from "@planificador/db";
import { bearerSession } from "./supabase/bearer";
import { createClient } from "./supabase/server";

export const getSupabase = cache(createClient);

export const getUser = cache(async () => {
  const supabase = await getSupabase();
  // La app móvil no guarda sesión en el cliente: se valida su token.
  const bearer = bearerSession.getStore();
  const { data } = bearer
    ? await supabase.auth.getUser(bearer.token)
    : await supabase.auth.getUser();
  return data.user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export interface MembershipWithWorkspace {
  workspaceId: string;
  workspaceName: string;
  role: Role;
  channelIds: string[] | null;
}

export const getMyMemberships = cache(async (): Promise<MembershipWithWorkspace[]> => {
  const user = await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("memberships")
    .select("role, channel_ids, workspace:workspaces(id, name)")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data ?? [])
    .filter((m) => m.workspace)
    .map((m) => ({
      workspaceId: m.workspace!.id,
      workspaceName: m.workspace!.name,
      role: m.role,
      channelIds: m.channel_ids,
    }))
    .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
});

export const getMyChannels = cache(async (): Promise<Tables<"channels">[]> => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("channels").select("*").order("name");
  if (error) throw error;
  return data ?? [];
});

export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await getSupabase();
  const { data } = await supabase.rpc("is_platform_admin");
  return Boolean(data);
});

export interface ChannelContext {
  channel: Tables<"channels">;
  role: Role;
  channelIds: string[] | null;
  userId: string;
  can: (permission: Permission) => boolean;
}

/** Canal visible para la sesión, con su rol. 404 si no existe o no tiene acceso. */
export const getChannelContext = cache(async (channelId: string): Promise<ChannelContext> => {
  const user = await requireUser();
  const channels = await getMyChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) notFound();
  const memberships = await getMyMemberships();
  const membership = memberships.find((m) => m.workspaceId === channel.workspace_id);
  if (!membership) notFound();
  const scope = { role: membership.role, channelIds: membership.channelIds };
  return {
    channel,
    role: membership.role,
    channelIds: membership.channelIds,
    userId: user.id,
    can: (permission) => canOnChannel(scope, channel.id, permission),
  };
});

export async function requireChannelPermission(channelId: string, permission: Permission) {
  const ctx = await getChannelContext(channelId);
  if (!ctx.can(permission)) throw new PermissionError();
  return ctx;
}

export class PermissionError extends Error {
  constructor() {
    super("errors.forbidden");
  }
}
