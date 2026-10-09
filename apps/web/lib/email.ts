import "server-only";
import { isConfigured } from "./env";

/**
 * Correo con Resend (dominio gartechs.com). La clave va solo en Vercel
 * (RESEND_API_KEY); el remitente se puede cambiar con RESEND_FROM.
 */
export const EMAIL_CONFIGURED = () => isConfigured("RESEND_API_KEY");

export const emailFrom = () =>
  process.env.RESEND_FROM ?? "Planificador <planificador@gartechs.com>";

const base = () => (process.env.RESEND_API_URL ?? "https://api.resend.com").replace(/\/$/, "");

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function resendRequest<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new EmailError("Falta RESEND_API_KEY", 0);
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) throw new EmailError(json.message ?? `Resend respondió ${res.status}`, res.status);
  return json;
}

export interface Email {
  to: string[];
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export const sendEmail = (email: Email) =>
  resendRequest<{ id: string }>("/emails", {
    from: email.from ?? emailFrom(),
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

export interface Broadcast {
  segmentId: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  name: string;
  /** ISO 8601; sin fecha, sale ya. */
  scheduledAt?: string | null;
}

/** Crea el envío masivo a un segmento y lo envía (o lo programa) en la misma llamada. */
export const sendBroadcast = (b: Broadcast) =>
  resendRequest<{ id: string }>("/broadcasts", {
    segment_id: b.segmentId,
    from: b.from,
    subject: b.subject,
    html: b.html,
    text: b.text,
    name: b.name,
    send: true,
    ...(b.scheduledAt && { scheduled_at: b.scheduledAt }),
  });
