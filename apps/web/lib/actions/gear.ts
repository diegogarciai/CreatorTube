"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GEAR_STATUSES, gearSchema, isMediaPathOf } from "@planificador/core";
import { getSupabase, requireChannelPermission } from "../auth";
import { startJob } from "../jobs";
import { MEDIA_BUCKET } from "../media";
import { createAdminClient } from "../supabase/admin";
import { GEAR_PARSE_ESTIMATE_CREDITS } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";

/**
 * «Mi equipo»: el inventario de dispositivos del canal. Lo maneja quien
 * maneja los episodios; la foto se sube desde el navegador a `{canal}/gear/`.
 */

const revalidate = (channelId: string) => revalidatePath(`/c/${channelId}/equipo`);

async function guard(channelId: string) {
  const ctx = await requireChannelPermission(channelId, "manage_episodes");
  return { ctx, admin: createAdminClient() };
}

const photoSchema = z.string().max(300).nullable().optional();

function checkPhoto(channelId: string, path: string | null | undefined) {
  if (path && !isMediaPathOf(path, channelId, "gear")) throw new Error("errors.invalid_input");
}

const toRow = (g: ReturnType<typeof gearSchema.parse>) => ({
  name: g.name,
  brand: g.brand,
  model: g.model,
  category: g.category,
  ownership: g.ownership,
  acquired_on: g.acquiredOn,
  return_by: g.returnBy,
  notes: g.notes,
  affiliate_url: g.affiliateUrl,
});

/** Agrega un equipo (con su foto, si se subió). */
export async function addGear(
  channelId: string,
  input: unknown,
  photo?: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const g = gearSchema.parse(input);
    const photoPath = photoSchema.parse(photo) ?? null;
    checkPhoto(channelId, photoPath);
    const { ctx, admin } = await guard(channelId);
    const { data, error } = await admin
      .from("gear")
      .insert({ channel_id: channelId, ...toRow(g), photo_path: photoPath, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) throw error;
    revalidate(channelId);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Edita un equipo. `photo`: una ruta nueva la reemplaza, `null` la quita y
 * `undefined` la deja como está. Editar uno «por revisar» lo confirma.
 */
export async function updateGear(
  channelId: string,
  id: string,
  input: unknown,
  photo?: unknown,
): Promise<ActionResult> {
  try {
    const g = gearSchema.parse(input);
    const photoPath = photoSchema.parse(photo);
    checkPhoto(channelId, photoPath);
    const { admin } = await guard(channelId);
    const { data: current } = await admin
      .from("gear")
      .select("photo_path, status")
      .eq("channel_id", channelId)
      .eq("id", id)
      .single();
    if (!current) throw new Error("errors.not_found");
    const { error } = await admin
      .from("gear")
      .update({
        ...toRow(g),
        ...(photoPath !== undefined && { photo_path: photoPath }),
        ...(current.status === "review" && { status: "active" }),
      })
      .eq("id", id);
    if (error) throw error;
    if (photoPath !== undefined && current.photo_path && current.photo_path !== photoPath)
      await admin.storage.from(MEDIA_BUCKET).remove([current.photo_path]);
    revalidate(channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const statusSchema = z.enum(GEAR_STATUSES).exclude(["review"]);

/** Confirma uno por revisar, o lo marca retirado, devuelto o de nuevo activo. */
export async function setGearStatus(
  channelId: string,
  id: string,
  status: unknown,
): Promise<ActionResult> {
  try {
    const s = statusSchema.parse(status);
    const { admin } = await guard(channelId);
    const { data, error } = await admin
      .from("gear")
      .update({ status: s })
      .eq("channel_id", channelId)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("errors.not_found");
    revalidate(channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Borra un equipo y su foto. */
export async function deleteGear(channelId: string, id: string): Promise<ActionResult> {
  try {
    const { admin } = await guard(channelId);
    const { data, error } = await admin
      .from("gear")
      .delete()
      .eq("channel_id", channelId)
      .eq("id", id)
      .select("photo_path")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("errors.not_found");
    if (data.photo_path) await admin.storage.from(MEDIA_BUCKET).remove([data.photo_path]);
    revalidate(channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const listSchema = z.string().trim().min(2).max(8000);

/** Claude ordena una lista pegada; los equipos quedan «por revisar». */
export async function pasteGearList(channelId: string, text: unknown): Promise<ActionResult> {
  try {
    const list = listSchema.parse(text);
    const { ctx, admin } = await guard(channelId);
    const { count: running } = await admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId)
      .eq("kind", "gear_parse")
      .in("status", ["queued", "running"]);
    if (running) return { ok: false, error: "errors.busy" };
    const supabase = await getSupabase();
    const { data: credits } = await supabase.rpc("workspace_credits", {
      ws: ctx.channel.workspace_id,
    });
    if (Number(credits?.[0]?.remaining ?? 0) < GEAR_PARSE_ESTIMATE_CREDITS)
      return { ok: false, error: "errors.no_credits" };
    await startJob(
      "gear_parse",
      { workspaceId: ctx.channel.workspace_id, channelId, requestedBy: ctx.userId },
      async (taskId) => {
        const { error } = await admin
          .from("gear_imports")
          .insert({ task_id: taskId, channel_id: channelId, text: list });
        if (error) throw error;
      },
    );
    revalidate(channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
