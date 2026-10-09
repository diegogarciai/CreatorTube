import { describe, expect, it } from "vitest";
import { renderNewsletterEmail, RESEND_UNSUBSCRIBE } from "./newsletter-email";

const draft = {
  subject: "La batería que no se acaba",
  preheader: "Lo medimos 18 horas seguidas.",
  body: "## Lo que medimos\n\nLa batería duró **18 horas** <de verdad>.",
  ctaText: "Ver el episodio",
  point: "Para estudiar alcanza con 16 GB.",
};
const base = {
  draft,
  ctaUrl: "https://youtu.be/aaaaaaaaaaa",
  newsletterName: "El Punto",
  accent: "#FF7A29",
  ink: "#111213",
};

describe("correo del boletín", () => {
  it("el envío masivo lleva preheader oculto, el punto, el botón y la baja de Resend", () => {
    const { html, text } = renderNewsletterEmail({ ...base, mode: "broadcast" });
    expect(html).toContain('<div style="display:none;');
    expect(html).toContain("Lo medimos 18 horas seguidas.");
    expect(html).toContain("Para estudiar alcanza con 16 GB.");
    expect(html).toContain("<strong>18 horas</strong> &lt;de verdad&gt;");
    expect(html).toContain('href="https://youtu.be/aaaaaaaaaaa"');
    expect(html).toContain(`href="${RESEND_UNSUBSCRIBE}"`);
    expect(html).toContain("max-width:600px");
    expect(text).toContain("EN UNA FRASE: Para estudiar alcanza con 16 GB.");
    expect(text).toContain("LO QUE MEDIMOS");
    expect(text).toContain("Ver el episodio: https://youtu.be/aaaaaaaaaaa");
    expect(text).toContain(`Darte de baja: ${RESEND_UNSUBSCRIBE}`);
  });

  it("la prueba no lleva la variable de Resend y un color raro cae al de la marca", () => {
    const { html } = renderNewsletterEmail({ ...base, accent: "red;x", mode: "test" });
    expect(html).not.toContain(RESEND_UNSUBSCRIBE);
    expect(html).toContain("border-top:4px solid #FF7A29");
  });
});
