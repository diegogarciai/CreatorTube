/**
 * Fechas en la zona horaria del canal.
 *
 * Las fechas de calendario (grabación, publicación planeada) se guardan como
 * "fechas locales" `YYYY-MM-DD` sin hora: un episodio planeado para el martes
 * es martes en la zona del canal, viva donde viva quien lo mira. Los instantes
 * reales (publicado en YouTube, cambios de estado) son `Date` en UTC y se
 * convierten a fecha local con `localDateKey`.
 */

/** Fecha local en formato ISO `YYYY-MM-DD`. */
export type DateKey = string;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function localDateKey(date: Date, timeZone: string): DateKey {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function isDateKey(value: string): value is DateKey {
  if (!DATE_KEY_RE.test(value)) return false;
  const d = toUtcDate(value);
  return d.toISOString().slice(0, 10) === value;
}

function toUtcDate(key: DateKey): Date {
  const m = DATE_KEY_RE.exec(key);
  if (!m) throw new Error(`Fecha inválida: ${key}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtcDate(d: Date): DateKey {
  return d.toISOString().slice(0, 10);
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = toUtcDate(key);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

/** Días de `from` a `to` (positivo si `to` es posterior). */
export function diffDays(from: DateKey, to: DateKey): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function isoWeekday(key: DateKey): number {
  const day = toUtcDate(key).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Lunes de la semana que contiene `key`. Las semanas empiezan en lunes. */
export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, 1 - isoWeekday(key));
}

export function weekDays(weekStart: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function isWithin(key: DateKey, start: DateKey, endInclusive: DateKey): boolean {
  return key >= start && key <= endInclusive;
}

/** Primer día del mes de `key`. */
export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 8)}01`;
}

export function addMonths(key: DateKey, months: number): DateKey {
  const d = toUtcDate(startOfMonth(key));
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUtcDate(d);
}

/**
 * Cuadrícula de un mes para el calendario: semanas completas de lunes a
 * domingo que cubren el mes de `key`.
 */
export function monthGrid(key: DateKey): DateKey[][] {
  const first = startOfMonth(key);
  const nextMonth = addMonths(first, 1);
  const weeks: DateKey[][] = [];
  let cursor = startOfWeek(first);
  while (cursor < nextMonth) {
    weeks.push(weekDays(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/**
 * Código legible del episodio: `PREFIJO-AAMMDD-HHMM` en la zona del canal.
 * Reemplaza el `GT-AAMMDD-HHMM` fijo en Bogotá del panel.
 */
export function episodeCode(prefix: string, createdAt: Date, timeZone: string): string {
  const p = zonedParts(createdAt, timeZone);
  const clean = prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "EP";
  return `${clean}-${pad(p.year % 100)}${pad(p.month)}${pad(p.day)}-${pad(p.hour)}${pad(p.minute)}`;
}
