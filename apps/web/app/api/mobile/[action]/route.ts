import { NextResponse, type NextRequest } from "next/server";
import { refreshAnalytics } from "@/lib/actions/analytics";
import { disconnectYouTube, syncChannelNow, updateChannelProfile } from "@/lib/actions/channels";
import { prepareDirection, saveDirection } from "@/lib/actions/direction";
import { removeMember, updateMember } from "@/lib/actions/members";
import { decideClaim, deletePodcast, deleteScript, startScript } from "@/lib/actions/script";
import {
  chooseThumbnail,
  deleteIdeas,
  deleteThumbnails,
  editThumbnailText,
  generateFromIdeas,
  generateThumbnails,
  proposeThumbnailIdeas,
} from "@/lib/actions/thumbnails";
import {
  deletePlan,
  deleteRenders,
  editAid,
  proposeVisualPlan,
  renderAid,
  renderApprovedAids,
  setAidStatus,
} from "@/lib/actions/visual-aids";
import { findImportableVideos, importYouTubeVideos } from "@/lib/actions/youtube-import";
import { actionArgs, bearerToken, nextErrorStatus } from "@/lib/mobile";
import { bearerSession } from "@/lib/supabase/bearer";
import { errorMessage } from "@/lib/utils";

/**
 * Entrada de la app móvil a las acciones que necesitan el servidor (IA,
 * YouTube, service role). Son las mismas acciones de la web, con la sesión que
 * llega en `Authorization: Bearer`: validan permisos igual y devuelven el mismo
 * `ActionResult`. Solo se exponen las de esta lista.
 *
 * POST /api/mobile/<acción>  { "args": [...] }
 */
const ACTIONS: Record<string, (...args: any[]) => Promise<unknown>> = {
  // Dirección y guion
  prepareDirection,
  saveDirection,
  startScript,
  decideClaim,
  deleteScript,
  deletePodcast,
  // Miniaturas
  proposeThumbnailIdeas,
  generateFromIdeas,
  generateThumbnails,
  editThumbnailText,
  chooseThumbnail,
  deleteIdeas,
  deleteThumbnails,
  // Ayudas visuales
  proposeVisualPlan,
  setAidStatus,
  editAid,
  renderApprovedAids,
  renderAid,
  deletePlan,
  deleteRenders,
  // YouTube y analítica
  refreshAnalytics,
  syncChannelNow,
  disconnectYouTube,
  findImportableVideos,
  importYouTubeVideos,
  // Canal y equipo (piden service role)
  updateChannelProfile,
  updateMember,
  removeMember,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token)
    return NextResponse.json({ ok: false, error: "errors.unauthorized" }, { status: 401 });

  const { action } = await params;
  const handler = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!handler) return NextResponse.json({ ok: false, error: "errors.not_found" }, { status: 404 });

  const args = actionArgs(await request.json().catch(() => ({})));
  if (!args)
    return NextResponse.json({ ok: false, error: "errors.invalid_input" }, { status: 400 });

  return bearerSession.run({ token }, async () => {
    try {
      return NextResponse.json(await handler(...args));
    } catch (err) {
      const status = nextErrorStatus(err);
      if (status === 401)
        return NextResponse.json({ ok: false, error: "errors.unauthorized" }, { status });
      if (status === 404)
        return NextResponse.json({ ok: false, error: "errors.not_found" }, { status });
      return NextResponse.json({ ok: false, error: errorMessage(err) }, { status: 500 });
    }
  });
}
