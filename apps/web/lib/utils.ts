import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) return "errors.invalid_input";
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err)
    return String((err as { message: unknown }).message);
  return "errors.unknown";
}

/** Formato corto de fecha local `YYYY-MM-DD` en español. */
export function formatDateKey(
  key: string | null,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("es", { ...opts, timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}
