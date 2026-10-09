import { describe, expect, it } from "vitest";
import { weeklyDigest, type PlannedEpisode } from "@planificador/core";
import { renderDigestEmail } from "./digest-email";

const ep = (o: Partial<PlannedEpisode>): PlannedEpisode => ({
  id: "e1",
  title: "Episodio",
  status: "planned",
  stage: "planning",
  publishDate: null,
  recordDate: null,
  youtubeVideoId: null,
  publishedOn: null,
  evaluatedAt: null,
  archivedAt: null,
  statusChangedAt: new Date("2026-10-01T12:00:00Z"),
  ...o,
});

describe("correo del resumen semanal", () => {
  const digest = weeklyDigest(
    [
      ep({ id: "a", title: "Atrasado <b>", publishDate: "2026-10-01", status: "editing" }),
      ep({ id: "b", title: "iPhone 18", publishDate: "2026-10-08", status: "script" }),
    ],
    "2026-10-05",
    2,
    new Date("2026-10-05T11:05:00Z"),
  );
  const mail = renderDigestEmail({
    digest,
    channelId: "ch1",
    channelName: "Gartechs",
    newIdeas: 3,
    appUrl: "https://app.gartechs.com",
  });

  it("asunto, agenda, alertas y banco de ideas en español", () => {
    expect(mail.subject).toBe("Gartechs: tu semana del 5 oct");
    expect(mail.text).toContain("Meta de la semana: 1 de 2 planeados · 0 publicados");
    expect(mail.text).toMatch(/- jue, 8 oct · Publicar: iPhone 18/);
    expect(mail.text).toContain("Atrasado:\n- «Atrasado <b>» debía publicarse hace 4 días");
    expect(mail.text).toContain("El banco tiene 3 ideas nuevas: conviene proponer más");
    expect(mail.text).toContain("https://app.gartechs.com/c/ch1");
  });

  it("el HTML escapa los títulos y enlaza cada episodio", () => {
    expect(mail.html).toContain("Atrasado &lt;b&gt;");
    expect(mail.html).not.toContain("Atrasado <b>");
    expect(mail.html).toContain('href="https://app.gartechs.com/c/ch1/episodios/b"');
  });
});
