"use server";

import { revalidatePath } from "next/cache";
import { assignableRoles, ROLES, type Role } from "@planificador/core";
import { getMyMemberships, requireUser } from "../auth";
import { createAdminClient } from "../supabase/admin";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Cambios de membresía: las políticas de RLS no permiten escribir membresías
 * desde el cliente, así que el servidor verifica el permiso y usa la service role.
 */
async function guard(workspaceId: string, targetUserId: string) {
  const me = await requireUser();
  const mine = (await getMyMemberships()).find((m) => m.workspaceId === workspaceId);
  if (!mine || assignableRoles(mine.role).length === 0) throw new Error("errors.forbidden");
  if (targetUserId === me.id) throw new Error("errors.forbidden");
  const admin = createAdminClient();
  const { data: target } = await admin
    .from("memberships")
    .select("id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId)
    .single();
  if (!target) throw new Error("errors.not_found");
  if (!assignableRoles(mine.role).includes(target.role)) throw new Error("errors.forbidden");
  return { admin, target, mine };
}

export async function updateMember(
  workspaceId: string,
  userId: string,
  input: { role: Role; channelIds: string[] | null },
): Promise<ActionResult> {
  try {
    const { admin, target, mine } = await guard(workspaceId, userId);
    if (!ROLES.includes(input.role) || !assignableRoles(mine.role).includes(input.role)) throw new Error("errors.forbidden");
    const { error } = await admin
      .from("memberships")
      .update({ role: input.role, channel_ids: input.channelIds && input.channelIds.length ? input.channelIds : null })
      .eq("id", target.id);
    if (error) throw error;
    revalidatePath(`/espacio/${workspaceId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeMember(workspaceId: string, userId: string): Promise<ActionResult> {
  try {
    const { admin, target } = await guard(workspaceId, userId);
    const { error } = await admin.from("memberships").delete().eq("id", target.id);
    if (error) throw error;
    revalidatePath(`/espacio/${workspaceId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
