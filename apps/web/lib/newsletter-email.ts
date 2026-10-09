import { markdownToHtml, markdownToText, type NewsletterDraft } from "@planificador/core";

/**
 * El correo del boletín (HTML de 600 px y texto). Va aparte del envío para
 * probarlo sin red. El enlace de baja lo pone Resend en cada envío masivo
 * ({{{RESEND_UNSUBSCRIBE_URL}}}); en la prueba va un enlace de muestra.
 */
export const RESEND_UNSUBSCRIBE = "{{{RESEND_UNSUBSCRIBE_URL}}}";

export interface NewsletterEmailInput {
  draft: NewsletterDraft;
  ctaUrl: string | null;
  newsletterName: string;
  /** El color de acento de la marca del canal. */
  accent: string;
  /** El color oscuro de la marca (texto del botón). */
  ink: string;
  /** Envío masivo (lleva el enlace de baja de Resend) o prueba. */
  mode: "broadcast" | "test";
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const HEX = /^#[0-9a-f]{6}$/i;
const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

export function renderNewsletterEmail(input: NewsletterEmailInput) {
  const { draft: d } = input;
  const accent = HEX.test(input.accent) ? input.accent : "#FF7A29";
  const ink = HEX.test(input.ink) ? input.ink : "#111213";
  const unsubscribe = input.mode === "broadcast" ? RESEND_UNSUBSCRIBE : "#baja";
  const text = (size: number, color = "#1f2937") =>
    `margin:0 0 16px;font-family:${FONT};font-size:${size}px;line-height:1.6;color:${color}`;
  const body = markdownToHtml(d.body, {
    p: text(16),
    h: `margin:24px 0 8px;font-family:${FONT};font-size:19px;line-height:1.3;color:#111827`,
    li: text(16).replace("margin:0 0 16px", "margin:0 0 6px"),
    a: `color:${ink};text-decoration:underline;text-decoration-color:${accent}`,
    quote: `margin:0 0 16px;padding:4px 0 4px 14px;border-left:3px solid ${accent};font-family:${FONT};font-size:16px;line-height:1.6;color:#374151;font-style:italic`,
  });
  const button =
    input.ctaUrl && d.ctaText.trim()
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px"><tr><td bgcolor="${accent}" style="background-color:${accent};border-radius:8px"><a href="${esc(input.ctaUrl)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;line-height:1.2;font-weight:700;color:${ink};text-decoration:none">${esc(d.ctaText.trim())}</a></td></tr></table>`
      : "";
  const point = d.point.trim()
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="padding:14px 18px;border-left:4px solid ${accent};background-color:#fff7ed"><p style="margin:0 0 4px;font-family:${FONT};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a3412">En una frase</p><p style="margin:0;font-family:${FONT};font-size:17px;line-height:1.5;font-weight:600;color:#111827">${esc(d.point.trim())}</p></td></tr></table>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>${esc(d.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f5f5f4">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(d.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f4" style="background-color:#f5f5f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-top:4px solid ${accent};border-radius:12px">
<tr><td style="padding:28px 32px 8px"><p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${ink}">${esc(input.newsletterName)}</p></td></tr>
<tr><td style="padding:8px 32px 28px">
${point}
${body}
${button}
</td></tr></table>
<p style="margin:16px auto 0;max-width:600px;font-family:${FONT};font-size:12px;line-height:1.5;color:#9ca3af">Recibes ${esc(input.newsletterName)} porque te suscribiste. <a href="${unsubscribe}" style="color:#6b7280;text-decoration:underline">Darte de baja</a></p>
</td></tr></table>
</body></html>`;
  const plain = [
    input.newsletterName.toUpperCase(),
    "",
    ...(d.point.trim() ? [`EN UNA FRASE: ${d.point.trim()}`, ""] : []),
    markdownToText(d.body),
    ...(input.ctaUrl && d.ctaText.trim() ? ["", `${d.ctaText.trim()}: ${input.ctaUrl}`] : []),
    "",
    `Darte de baja: ${unsubscribe}`,
  ].join("\n");
  return { html, text: plain };
}
