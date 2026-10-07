import { NextResponse, type NextRequest } from "next/server";
import { buildIcs, type IcsEvent } from "@planificador/core";
import { BRAND } from "@planificador/config";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import messages from "@/messages/es.json";

/**
 * Calendario ICS público por canal (enlace secreto). Se suscribe una vez en
 * Apple, Google u Outlook; no necesita permisos de calendario.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = (await params).token.replace(/\.ics$/i, "");
  if (!/^[0-9a-f]{64}$/.test(token)) return new NextResponse("No encontrado", { status: 404 });

  const admin = createAdminClient();
  const { data: channel } = await admin
    .from("channels")
    .select("id, name, timezone")
    .eq("ics_token", token)
    .maybeSingle();
  if (!channel) return new NextResponse("No encontrado", { status: 404 });

  const { data: episodes } = await admin
    .from("episodes")
    .select("id, number, title, status, publish_date, record_date")
    .eq("channel_id", channel.id)
    .is("archived_at", null)
    .or("publish_date.not.is.null,record_date.not.is.null");

  const status = messages.status as Record<string, string>;
  const events: IcsEvent[] = [];
  for (const e of episodes ?? []) {
    const url = `${env.appUrl}/c/${channel.id}/episodios/${e.id}`;
    const description = `${status[e.status] ?? e.status} · #${e.number}`;
    if (e.publish_date) {
      events.push({
        uid: `${e.id}-publish@planificador`,
        date: e.publish_date,
        summary: `▶ ${messages.calendar.publish}: ${e.title}`,
        description,
        url,
      });
    }
    if (e.record_date && ["planned", "script", "to_record"].includes(e.status)) {
      events.push({
        uid: `${e.id}-record@planificador`,
        date: e.record_date,
        summary: `● ${messages.calendar.record}: ${e.title}`,
        description,
        url,
      });
    }
  }

  const body = buildIcs({
    name: `${channel.name} · ${BRAND.name}`,
    prodId: `-//${BRAND.name}//ES`,
    timeZone: channel.timezone,
    events,
  });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${channel.id}.ics"`,
      "cache-control": "private, max-age=300",
    },
  });
}
