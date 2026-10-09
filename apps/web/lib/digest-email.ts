import { createTranslator } from "next-intl";
import { IDEAS_LOW_BANK, type Alert, type WeeklyDigest } from "@planificador/core";
import messages from "../messages/es.json";
import { formatDateKey } from "./utils";

/**
 * El correo del resumen semanal (HTML y texto). Va aparte del envío para
 * probarlo sin red ni base.
 */
export interface DigestEmailInput {
  digest: WeeklyDigest;
  channelId: string;
  channelName: string;
  /** Ideas nuevas en el banco. */
  newIdeas: number;
  appUrl: string;
}

const ACCENT = "#ea580c";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderDigestEmail(input: DigestEmailInput) {
  const t = createTranslator({ locale: "es", messages });
  const { digest: d, channelName } = input;
  const day = (key: string) =>
    formatDateKey(key, { weekday: "short", day: "numeric", month: "short" });
  const url = `${input.appUrl}/c/${input.channelId}`;
  const alertText = (a: Alert) =>
    t(
      `alerts.${a.kind}` as "alerts.overdue_publish",
      {
        ...a.params,
        ...(typeof a.params.weekStart === "string" && {
          weekStart: formatDateKey(a.params.weekStart),
        }),
      } as Record<string, string | number>,
    );
  const alertUrl = (a: Alert) =>
    a.episodeId ? `${url}/episodios/${a.episodeId}` : `${url}/calendario`;

  const subject = t("digest.subject", { channel: channelName, date: formatDateKey(d.weekStart) });
  const heading = t("digest.heading", { channel: channelName });
  const period = t("digest.period", { start: day(d.weekStart), end: day(d.weekEnd) });
  const goal =
    d.coverage.goal > 0
      ? t("digest.goal", {
          planned: d.coverage.planned,
          goal: d.coverage.goal,
          published: d.coverage.published,
        })
      : t("digest.noGoal");
  const lastWeek =
    d.lastWeek.goal > 0
      ? t("digest.lastWeek", { published: d.lastWeek.published, goal: d.lastWeek.goal })
      : "";
  const ideas =
    t("digest.ideas", { count: input.newIdeas }) +
    (input.newIdeas < IDEAS_LOW_BANK ? `: ${t("digest.ideasLow")}` : ".");
  const agenda = d.agenda.map((a) => ({
    when: day(a.date),
    what: a.kind === "record" ? t("digest.record") : t("digest.publish"),
    title: a.title,
    href: `${url}/episodios/${a.episodeId}`,
  }));
  const sections: { title: string; items: { text: string; href: string }[] }[] = [
    {
      title: t("digest.overdue"),
      items: d.overdue.map((a) => ({ text: alertText(a), href: alertUrl(a) })),
    },
    {
      title: t("digest.atRisk"),
      items: d.atRisk.map((a) => ({ text: alertText(a), href: alertUrl(a) })),
    },
  ].filter((s) => s.items.length);

  const text = [
    heading,
    period,
    "",
    goal,
    lastWeek,
    "",
    `${t("digest.agenda")}:`,
    ...(agenda.length
      ? agenda.map((a) => `- ${a.when} · ${a.what}: ${a.title}`)
      : [t("digest.agendaEmpty")]),
    ...sections.flatMap((s) => ["", `${s.title}:`, ...s.items.map((i) => `- ${i.text}`)]),
    "",
    ideas,
    "",
    `${t("digest.open")}: ${url}`,
    "",
    t("digest.footer"),
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  const h2 = (s: string) =>
    `<h2 style="margin:24px 0 8px;font-size:15px;color:#111827">${esc(s)}</h2>`;
  const p = (s: string, extra = "") =>
    s
      ? `<p style="margin:4px 0;font-size:14px;line-height:1.5;color:#374151${extra}">${esc(s)}</p>`
      : "";
  const link = (href: string, s: string) =>
    `<a href="${esc(href)}" style="color:#111827;text-decoration:underline">${esc(s)}</a>`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border-top:4px solid ${ACCENT}">
<tr><td style="padding:24px 28px">
<h1 style="margin:0;font-size:20px;color:#111827">${esc(heading)}</h1>
${p(period, ";color:#6b7280")}
${h2(goal)}
${p(lastWeek)}
${h2(t("digest.agenda"))}
${
  agenda.length
    ? `<ul style="margin:0;padding-left:18px">${agenda
        .map(
          (a) =>
            `<li style="font-size:14px;line-height:1.6;color:#374151"><strong>${esc(a.when)}</strong> · ${esc(a.what)}: ${link(a.href, a.title)}</li>`,
        )
        .join("")}</ul>`
    : p(t("digest.agendaEmpty"))
}
${sections
  .map(
    (s) =>
      `${h2(s.title)}<ul style="margin:0;padding-left:18px">${s.items
        .map(
          (i) =>
            `<li style="font-size:14px;line-height:1.6;color:#374151">${link(i.href, i.text)}</li>`,
        )
        .join("")}</ul>`,
  )
  .join("\n")}
${h2(ideas)}
<p style="margin:28px 0 8px"><a href="${esc(url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${esc(t("digest.open"))}</a></p>
</td></tr></table>
<p style="max-width:600px;margin:12px auto 0;font-size:12px;color:#9ca3af">${esc(t("digest.footer"))}</p>
</td></tr></table></body></html>`;
  return { subject, html, text };
}
