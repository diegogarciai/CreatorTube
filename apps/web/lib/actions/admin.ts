"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_STAGES } from "@planificador/ai";
import { getMyMemberships, isPlatformAdmin, requireUser } from "../auth";
import { startJob } from "../jobs";
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

/** Lanza la tarea de prueba del motor en el primer espacio propio del administrador. */
export async function testJobEngine(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!(await isPlatformAdmin())) return { ok: false, error: "errors.forbidden" };
    const ws = (await getMyMemberships()).find((m) => m.role === "owner");
    if (!ws) return { ok: false, error: "errors.jobs_no_workspace" };
    await startJob("ping", { workspaceId: ws.workspaceId, requestedBy: user.id });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Pide a la API la lista de modelos de la cuenta (tarea en el motor). */
export async function refreshAiModels(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!(await isPlatformAdmin())) return { ok: false, error: "errors.forbidden" };
    const ws = (await getMyMemberships()).find((m) => m.role === "owner");
    if (!ws) return { ok: false, error: "errors.jobs_no_workspace" };
    await startJob("ai_models_refresh", { workspaceId: ws.workspaceId, requestedBy: user.id });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const price = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().min(0).max(1000).nullable(),
);

/** Precio de un modelo por millón de tokens; vacío vuelve a los precios por defecto. */
export async function setModelPrices(
  modelId: string,
  input: unknown,
  output: unknown,
): Promise<ActionResult> {
  try {
    await requireUser();
    if (!(await isPlatformAdmin())) return { ok: false, error: "errors.forbidden" };
    const { error } = await createAdminClient()
      .from("ai_models")
      .update({ input_price_usd: price.parse(input), output_price_usd: price.parse(output) })
      .eq("id", z.string().min(1).parse(modelId));
    if (error) throw error;
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const settingsSchema = z.object({
  defaultModel: z.string().min(1).nullable(),
  stageModels: z.partialRecord(z.enum(AI_STAGES), z.string().min(1)),
});

/** El modelo por defecto de un espacio y, si se quiere, uno por etapa. */
export async function setWorkspaceAiSettings(
  workspaceId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!(await isPlatformAdmin())) return { ok: false, error: "errors.forbidden" };
    const { defaultModel, stageModels } = settingsSchema.parse(input);
    const admin = createAdminClient();
    // Solo modelos del catálogo.
    const wanted = [...new Set([defaultModel, ...Object.values(stageModels)].filter(Boolean))];
    if (wanted.length) {
      const { data } = await admin
        .from("ai_models")
        .select("id")
        .in("id", wanted as string[]);
      if ((data ?? []).length !== wanted.length)
        return { ok: false, error: "errors.invalid_input" };
    }
    const { error } = await admin.from("workspace_ai_settings").upsert({
      workspace_id: workspaceId,
      default_model: defaultModel,
      stage_models: stageModels,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Presupuesto mensual de un servicio; vacío lo quita. YouTube va en % de la cuota diaria. */
export async function setServiceBudget(service: unknown, value: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!(await isPlatformAdmin())) return { ok: false, error: "errors.forbidden" };
    const name = z.enum(["ai", "parallel", "youtube", "gemini"]).parse(service);
    const amount = z
      .preprocess(
        (v) => (v === "" || v === null || v === undefined ? null : v),
        z.coerce.number().min(0).max(100_000).nullable(),
      )
      .parse(value);
    const admin = createAdminClient();
    const { error } =
      amount === null
        ? await admin.from("service_budgets").delete().eq("service", name)
        : await admin.from("service_budgets").upsert({
            service: name,
            monthly_usd: amount,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          });
    if (error) throw error;
    revalidatePath("/admin/consumo");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
