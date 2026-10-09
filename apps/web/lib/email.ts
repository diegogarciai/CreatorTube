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
