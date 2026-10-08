"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isPlatformAdmin, requireUser } from "../auth";
import { createAdminClient } from "../supabase/admin";
import { errorMessage, type ActionResult } from "../utils";

/** Cupo mensual de IA de un espacio, en dólares (1 crédito = US$0,01). */
export async function setWorkspaceCredits(
  workspaceId: string,
  usd: unknown,
): Promise<ActionResult> {
  try {
    await requireUser();
    if (!(await isPlatformAdmin())) return { ok: false, error: "errors.forbidden" };
    const dollars = z.coerce.number().min(0).max(10_000).parse(usd);
    const { error } = await createAdminClient()
      .from("workspaces")
      .update({ monthly_credits: Math.round(dollars * 100) })
      .eq("id", workspaceId);
    if (error) throw error;
    revalidatePath("/admin");
    revalidatePath(`/espacio/${workspaceId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
