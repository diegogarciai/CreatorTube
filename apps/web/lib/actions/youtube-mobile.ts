"use server";

import { z } from "zod";
import { can } from "@planificador/core";
import { getMyMemberships, requireChannelPermission, requireUser } from "../auth";
import { env, YOUTUBE_CONFIGURED } from "../env";
import { encodeMobileTicket } from "../mobile";
import { errorMessage, type ActionResult } from "../utils";
import { mobileTicketKey } from "../youtube";

const targetSchema = z
  .object({ channelId: z.uuid().optional(), workspaceId: z.uuid().optional() })
  .refine((t) => t.channelId || t.workspaceId);

/**
 * Enlace para conectar YouTube desde la app: un canal existente (reconectar)
 * o uno nuevo en un espacio. Pide los mismos permisos que
 * `/api/youtube/connect`; el enlace lleva un ticket firmado que vence en
 * 5 minutos, porque el navegador que lo abre no tiene la sesión de la web.
 */
export async function youtubeConnectLink(target: {
  channelId?: string;
  workspaceId?: string;
}): Promise<ActionResult<{ url: string }>> {
  try {
    if (!YOUTUBE_CONFIGURED()) return { ok: false, error: "errors.youtube_config" };
    const user = await requireUser();
    const input = targetSchema.parse(target);

    let workspaceId = input.workspaceId ?? "";
    if (input.channelId) {
      const ctx = await requireChannelPermission(input.channelId, "configure_channel");
      workspaceId = ctx.channel.workspace_id;
    } else {
      const m = (await getMyMemberships()).find((x) => x.workspaceId === workspaceId);
      if (!m || !can(m.role, "configure_channel")) return { ok: false, error: "errors.forbidden" };
    }

    const ticket = encodeMobileTicket(
      { workspaceId, userId: user.id, channelId: input.channelId },
      mobileTicketKey(),
    );
    const url = new URL("/api/youtube/mobile", env.appUrl);
    url.searchParams.set("ticket", ticket);
    return { ok: true, data: { url: url.toString() } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
