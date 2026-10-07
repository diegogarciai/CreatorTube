import type { DateKey } from "./time";
import { addDays } from "./time";

/**
 * Calendario ICS por canal (RFC 5545). Se suscribe una vez en Apple, Google
 * u Outlook y reemplaza la conexión a Google Calendar del panel.
 * Los eventos son de día completo porque las fechas del canal son locales.
 */
export interface IcsEvent {
  uid: string;
  date: DateKey;
  summary: string;
  description?: string;
  url?: string;
}

export interface IcsCalendar {
  name: string;
  /** Identificador del producto, p. ej. "-//Planificador//ES". */
  prodId: string;
  timeZone?: string;
  events: IcsEvent[];
  now?: Date;
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Pliega líneas a 75 octetos como pide el RFC, sin partir caracteres UTF-8. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    if (currentBytes + bytes > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74; // las líneas de continuación empiezan con un espacio
    }
    current += ch;
    currentBytes += bytes;
  }
  out.push(current);
  return out.join("\r\n ");
}

const compactDate = (key: DateKey) => key.replace(/-/g, "");

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildIcs(cal: IcsCalendar): string {
  const stamp = utcStamp(cal.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${cal.prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(cal.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  if (cal.timeZone) lines.push(`X-WR-TIMEZONE:${cal.timeZone}`);
  for (const ev of cal.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(ev.date)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(ev.date, 1))}`,
      `SUMMARY:${escapeIcsText(ev.summary)}`,
      "TRANSP:TRANSPARENT",
    );
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
