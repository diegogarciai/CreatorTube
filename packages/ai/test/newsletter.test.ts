import { describe, expect, it } from "vitest";
import { writeNewsletter } from "../src";

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function client(answers: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: {
      beta: {
        messages: {
          parse: async (params: Record<string, unknown>) => {
            calls.push(params);
            return {
              model: "m",
              stop_reason: "end_turn",
              usage,
              parsed_output: answers[calls.length - 1],
            };
          },
        },
      },
    } as never,
  };
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");
const good = {
  subject: "La batería que no se acaba",
  preheader: "Lo medimos 18 horas seguidas.",
  body: words(450),
  cta_text: "Ver el episodio",
  cta_episode: 2,
  point: "Para estudiar alcanza con 16 GB.",
};
const input = {
  mode: "weekly" as const,
  channelName: "Gartechs",
  newsletterName: "El Punto",
  guide: "21. BOLETÍN\nUna idea por semana.",
  episodes: [
    {
      title: "MacBook Air M4",
      url: "https://youtu.be/aaaaaaaaaaa",
      stance: "Para estudiar alcanza con 16 GB.",
      script: "La batería duró 18 horas.",
      claims: [],
      audience: ["¿Sirve para editar video?"],
      comments: ["Yo lo uso para Lightroom y va sobrado."],
    },
    {
      title: "iPad Air",
      url: "https://youtu.be/bbbbbbbbbbb",
      stance: "",
      script: "Otro guion.",
      claims: [],
      audience: [],
      comments: [],
    },
  ],
  today: "2026-10-09",
};

describe("boletín semanal", () => {
  it("redacta con la guía, los episodios y la audiencia, y elige el episodio del botón", async () => {
    const { client: c, calls } = client([good]);
    const out = await writeNewsletter(c, { model: "m" }, input);
    expect(calls).toHaveLength(1);
    const user = String((calls[0]!.messages as { content: string }[])[0]!.content);
    expect(user).toContain("21. BOLETÍN");
    expect(user).toContain("### Episodio 1: MacBook Air M4");
    expect(user).toContain("- ¿Sirve para editar video?");
    expect(user).toContain("## Los videos que eligió Diego");
    expect(user).toContain("- Yo lo uso para Lightroom y va sobrado.");
    expect(String(calls[0]!.system)).toContain("resume los videos que Diego eligió");
    expect(out.draft).toMatchObject({ subject: good.subject, ctaText: "Ver el episodio" });
    expect(out.ctaEpisode).toBe(1);
    expect(out.repaired).toBe(false);
  });

  it("corrige una vez lo que no cumple el formato", async () => {
    const { client: c, calls } = client([
      { ...good, subject: "x".repeat(70), body: words(200), cta_episode: 9 },
      { ...good, cta_episode: 0 },
    ]);
    const out = await writeNewsletter(c, { model: "m" }, input);
    expect(calls).toHaveLength(2);
    const fix = String((calls[1]!.messages as { content: string }[])[0]!.content);
    expect(fix).toContain("- El asunto tiene 70 caracteres; máximo 55.");
    expect(fix).toContain("- El cuerpo tiene 200 palabras; mínimo 400.");
    expect(out.repaired).toBe(true);
    expect(out.draft.subject).toBe(good.subject);
    // El botón se queda en el episodio que había (acotado a la lista).
    expect(out.ctaEpisode).toBe(1);
    expect(out.usage.input_tokens).toBe(200);
  });

  it("el de un episodio lleva las notas de Diego y sus instrucciones", async () => {
    const { client: c, calls } = client([good]);
    await writeNewsletter(
      c,
      { model: "m" },
      {
        ...input,
        mode: "episode",
        notes: "Me sorprendió que el ventilador no hiciera falta.",
        episodes: [input.episodes[0]!],
      },
    );
    const user = String((calls[0]!.messages as { content: string }[])[0]!.content);
    expect(user).toContain("## Las notas de Diego (sus apreciaciones)\nMe sorprendió");
    expect(user).toContain("## El episodio");
    expect(String(calls[0]!.system)).toContain("son las apreciaciones de Diego");
  });
});
