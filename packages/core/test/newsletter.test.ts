import { describe, expect, it } from "vitest";
import {
  commentImportance,
  importantComments,
  markdownToHtml,
  markdownToText,
  newsletterIssueText,
  validateNewsletter,
  newsletterWords,
  type NewsletterDraft,
} from "../src";

const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");
const ok: NewsletterDraft = {
  subject: "El iPhone 18 no es para ti (todavía)",
  preheader: "Lo que medimos, lo que no te dicen y a quién sí le conviene.",
  body: words(500),
  ctaText: "Ver el episodio",
  point: "Si tu teléfono tiene menos de tres años, espera.",
};

describe("boletín", () => {
  it("cuenta palabras sin contar signos sueltos", () => {
    expect(newsletterWords("Hola — mundo, 18 veces · ok")).toBe(5);
  });

  it("valida los topes de §21", () => {
    expect(validateNewsletter(ok)).toEqual([]);
    const bad = {
      subject: "x".repeat(56),
      preheader: "y".repeat(91),
      body: words(300),
      ctaText: "Mira el episodio completo ahora",
      point: "z".repeat(141),
    };
    expect(validateNewsletter(bad)).toEqual([
      "subject_long",
      "preheader_long",
      "body_short",
      "cta_long",
      "point_long",
    ]);
    expect(
      validateNewsletter({ ...ok, body: words(701), subject: " ", ctaText: "", point: "" }),
    ).toEqual(["subject_empty", "body_long", "cta_empty", "point_empty"]);
    expect(newsletterIssueText("body_short", bad)).toBe(
      "El cuerpo tiene 300 palabras; mínimo 400.",
    );
  });

  it("convierte el markdown a HTML seguro y a texto", () => {
    const md = [
      "## Lo que medimos",
      "Un párrafo con **negrita**, *cursiva* y un [enlace](https://gartechs.com/el-punto?a=1&b=2).",
      "- uno\n- dos <script>",
      "> una cita",
      "[malo](javascript:alert(1))",
    ].join("\n\n");
    const html = markdownToHtml(md, { p: "margin:0" });
    expect(html).toContain("<h2>Lo que medimos</h2>");
    expect(html).toContain(
      '<p style="margin:0">Un párrafo con <strong>negrita</strong>, <em>cursiva</em> y un <a href="https://gartechs.com/el-punto?a=1&amp;b=2">enlace</a>.</p>',
    );
    expect(html).toContain("<li>dos &lt;script&gt;</li>");
    expect(html).toContain("<blockquote>una cita</blockquote>");
    expect(html).not.toContain("javascript:");
    expect(markdownToText(md)).toBe(
      [
        "LO QUE MEDIMOS",
        "Un párrafo con negrita, cursiva y un enlace (https://gartechs.com/el-punto?a=1&b=2).",
        "- uno\n- dos <script>",
        "una cita",
        "malo (javascript:alert(1))",
      ].join("\n\n"),
    );
  });

  it("elige los comentarios importantes: tipo y apoyo, sin trolls ni marcados", () => {
    const c = (id: string, kind: string | null, likes = 0, extra = {}) => ({
      id,
      kind: kind as never,
      flags: [] as string[],
      likes,
      replies: 0,
      ...extra,
    });
    const list = [
      c("elogio", "elogio", 2),
      c("pregunta", "pregunta_tecnica", 3),
      c("correccion", "correccion", 0, { correctionValid: true }),
      c("correccion-mala", "correccion", 0, { correctionValid: false }),
      c("viral", "elogio", 200),
      c("troll", "troll_spam", 500),
      c("marcado", "pregunta_tecnica", 50, { flags: ["datos_personales"] }),
    ];
    expect(importantComments(list, 4).map((x) => x.id)).toEqual([
      "viral",
      "pregunta",
      "correccion",
      "elogio",
    ]);
    expect(commentImportance(list[5]!)).toBe(-1);
    expect(importantComments(list, 10)).toHaveLength(5);
  });
});
