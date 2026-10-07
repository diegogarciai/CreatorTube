"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assignableRoles, invitationSchema } from "@planificador/core";
import { getMyMemberships, isPlatformAdmin, requireUser, getSupabase } from "../auth";
import { env } from "../env";
import { newInvitationToken } from "../tokens";
import { errorMessage, type ActionResult } from "../utils";

export async function acceptInvitation(token: string, formData: FormData) {
  await requireUser();
  const supabase = await getSupabase();
  const workspaceName = String(formData.get("workspaceName") ?? "").trim() || undefined;
  const { data: preview } = await supabase.rpc("invitation_preview", { token });
  const { data: workspaceId, error } = await supabase.rpc("accept_invitation", {
    token,
    workspace_name: workspaceName,
  });
  if (error)
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/", "layout");
  redirect(preview?.[0]?.kind === "platform" ? `/onboarding?workspace=${workspaceId}` : "/app");
}

/** Invitación a un espacio existente (rol distinto de propietario). */
export async function inviteMember(
  workspaceId: string,
  input: { email: string; role: string; channelIds: string[] | null },
): Promise<ActionResult<{ link: string }>> {
  try {
    const user = await requireUser();
    const parsed = invitationSchema.parse(input);
    const membership = (await getMyMemberships()).find((m) => m.workspaceId === workspaceId);
    if (
      !membership ||
      !assignableRoles(membership.role).includes(parsed.role) ||
      parsed.role === "owner"
    ) {
      return { ok: false, error: "errors.forbidden" };
    }
    const { token, hash } = newInvitationToken();
    const supabase = await getSupabase();
    const { error } = await supabase.from("invitations").insert({
      kind: "workspace",
      workspace_id: workspaceId,
      email: parsed.email,
      role: parsed.role,
      channel_ids: parsed.channelIds && parsed.channelIds.length > 0 ? parsed.channelIds : null,
      token_hash: hash,
      invited_by: user.id,
    });
    if (error) throw error;
    revalidatePath(`/espacio/${workspaceId}`);
    return { ok: true, data: { link: `${env.appUrl}/invite/${token}` } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Invitación de plataforma: la persona crea su propio espacio. */
export async function inviteCreator(input: {
  email: string;
}): Promise<ActionResult<{ link: string }>> {
  try {
    const user = await requireUser();
    if (!(await isPlatformAdmin())) return { ok: false, error: "errors.forbidden" };
    const { email } = invitationSchema.pick({ email: true }).parse(input);
    const { token, hash } = newInvitationToken();
    const supabase = await getSupabase();
    const { error } = await supabase.from("invitations").insert({
      kind: "platform",
      email,
      role: "owner",
      token_hash: hash,
      invited_by: user.id,
    });
    if (error) throw error;
    revalidatePath("/admin");
    return { ok: true, data: { link: `${env.appUrl}/invite/${token}` } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  try {
    const supabase = await getSupabase();
    const { error, count } = await supabase
      .from("invitations")
      .delete({ count: "exact" })
      .eq("id", invitationId);
    if (error) throw error;
    if (!count) return { ok: false, error: "errors.forbidden" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
