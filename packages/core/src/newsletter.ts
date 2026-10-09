/**
 * Boletín semanal (Fase 4 · paso 5, §21 de la guía): los topes de formato y el
 * cuerpo en markdown sencillo, que se convierte a HTML y a texto para el correo.
 */

export const NEWSLETTER_LIMITS = {
  subject: 55,
  preheader: 90,
  bodyMinWords: 400,
  bodyMaxWords: 700,
  ctaWords: 4,
  point: 140,
} as const;

export interface NewsletterDraft {
  subject: string;
  preheader: string;
  /** Cuerpo en markdown sencillo (párrafos, ##, listas, **negrita**, *cursiva*, enlaces). */
  body: string;
  /** El texto del botón. */
  ctaText: string;
  /** «El punto»: la idea de la semana en una frase. */
  point: string;
}

export type NewsletterIssue =
  | "subject_empty"
  | "subject_long"
  | "preheader_long"
  | "body_short"
  | "body_long"
  | "cta_empty"
  | "cta_long"
  | "point_empty"
  | "point_long";

export const newsletterWords = (s: string) =>
  s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

const chars = (s: string) => [...s.trim()].length;

/** Lo que no cumple el formato (vacío = listo para enviar). */
export function validateNewsletter(d: NewsletterDraft): NewsletterIssue[] {
  const L = NEWSLETTER_LIMITS;
  const out: NewsletterIssue[] = [];
  if (!d.subject.trim()) out.push("subject_empty");
  else if (chars(d.subject) > L.subject) out.push("subject_long");
  if (chars(d.preheader) > L.preheader) out.push("preheader_long");
  const words = newsletterWords(d.body);
  if (words < L.bodyMinWords) out.push("body_short");
  else if (words > L.bodyMaxWords) out.push("body_long");
  if (!d.ctaText.trim()) out.push("cta_empty");
  else if (newsletterWords(d.ctaText) > L.ctaWords) out.push("cta_long");
  if (!d.point.trim()) out.push("point_empty");
  else if (chars(d.point) > L.point) out.push("point_long");
  return out;
}

/** Los motivos en palabras, para pedirle a Claude que corrija. */
export function newsletterIssueText(issue: NewsletterIssue, d: NewsletterDraft): string {
  const L = NEWSLETTER_LIMITS;
  switch (issue) {
    case "subject_empty":
      return "Falta el asunto.";
    case "subject_long":
      return `El asunto tiene ${chars(d.subject)} caracteres; máximo ${L.subject}.`;
    case "preheader_long":
      return `El preheader tiene ${chars(d.preheader)} caracteres; máximo ${L.preheader}.`;
    case "body_short":
      return `El cuerpo tiene ${newsletterWords(d.body)} palabras; mínimo ${L.bodyMinWords}.`;
    case "body_long":
      return `El cuerpo tiene ${newsletterWords(d.body)} palabras; máximo ${L.bodyMaxWords}.`;
    case "cta_empty":
      return "Falta el texto del botón.";
    case "cta_long":
      return `El botón tiene ${newsletterWords(d.ctaText)} palabras; máximo ${L.ctaWords}.`;
    case "point_empty":
      return "Falta «el punto».";
    case "point_long":
      return `«El punto» tiene ${chars(d.point)} caracteres; máximo ${L.point}.`;
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export interface MarkdownStyles {
  p?: string;
  h?: string;
  li?: string;
  a?: string;
  quote?: string;
}

/** Negrita, cursiva y enlaces dentro de una línea (ya escapada). */
function inline(text: string, styles: MarkdownStyles): string {
  const attr = (s?: string) => (s ? ` style="${s}"` : "");
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
      const href = url.replace(/&amp;/g, "&");
      return SAFE_URL.test(href) ? `<a href="${esc(href)}"${attr(styles.a)}>${label}</a>` : label;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

type Block = { kind: "p" | "h" | "quote"; text: string } | { kind: "list"; items: string[] };

function blocks(md: string): Block[] {
  const out: Block[] = [];
  for (const chunk of md.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      out.push({ kind: "list", items: lines.map((l) => l.replace(/^[-*]\s+/, "")) });
    } else if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0]!)) {
      out.push({ kind: "h", text: lines[0]!.replace(/^#{1,3}\s+/, "") });
    } else if (lines.every((l) => l.startsWith(">"))) {
      out.push({ kind: "quote", text: lines.map((l) => l.replace(/^>\s?/, "")).join(" ") });
    } else {
      out.push({ kind: "p", text: lines.join(" ") });
    }
  }
  return out;
}

/** Markdown sencillo → HTML para correo (estilos en línea, enlaces solo http/https/mailto). */
export function markdownToHtml(md: string, styles: MarkdownStyles = {}): string {
  const attr = (s?: string) => (s ? ` style="${s}"` : "");
  return blocks(md)
    .map((b) => {
      if (b.kind === "list")
        return `<ul>${b.items.map((i) => `<li${attr(styles.li)}>${inline(i, styles)}</li>`).join("")}</ul>`;
      if (b.kind === "h") return `<h2${attr(styles.h)}>${inline(b.text, styles)}</h2>`;
      if (b.kind === "quote")
        return `<blockquote${attr(styles.quote)}>${inline(b.text, styles)}</blockquote>`;
      return `<p${attr(styles.p)}>${inline(b.text, styles)}</p>`;
    })
    .join("\n");
}

/** Markdown sencillo → texto plano (los enlaces quedan como «texto (url)»). */
export function markdownToText(md: string): string {
  const plain = (s: string) =>
    s
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2");
  return blocks(md)
    .map((b) =>
      b.kind === "list"
        ? b.items.map((i) => `- ${plain(i)}`).join("\n")
        : b.kind === "h"
          ? plain(b.text).toUpperCase()
          : plain(b.text),
    )
    .join("\n\n");
}
