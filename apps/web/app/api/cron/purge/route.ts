import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";

/** Retención diaria: textos de YouTube a 30 días y datos de canales desconectados. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) return new NextResponse("No autorizado", { status: 401 });
  const { data, error } = await createAdminClient().rpc("purge_youtube_data");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
