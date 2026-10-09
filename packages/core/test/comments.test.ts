import { describe, expect, it } from "vitest";
import { canSuggestReply, channelAudience, commentUrl, emptyReading } from "../src";

describe("comentarios", () => {
  it("no se sugiere respuesta al troll ni a lo marcado", () => {
    expect(canSuggestReply("elogio", [])).toBe(true);
    expect(canSuggestReply("troll_spam", [])).toBe(false);
    expect(canSuggestReply("pregunta_tecnica", ["datos_personales"])).toBe(false);
  });

  it("Audiencia junta las lecturas: dolores por conteo, temas sumados, correcciones e ideas con su episodio", () => {
    const a = {
      ...emptyReading(),
      themes: [{ theme: "Batería", count: 3 }],
      pains: [{ pain: "No sé si alcanza 8 GB", count: 2, quote: "¿me alcanza?" }],
      corrections: ["El precio era 999"],
    };
    const b = {
      ...emptyReading(),
      themes: [
        { theme: "batería ", count: 2 },
        { theme: "Precio", count: 4 },
      ],
      pains: [{ pain: "Precio alto", count: 5, quote: "muy caro" }],
      ideas: ["Comparar con Windows"],
    };
    const out = channelAudience([
      { episodeId: "e1", reading: a },
      { episodeId: "e2", reading: b },
    ]);
    expect(out.pains.map((p) => [p.pain, p.episodeId, p.index])).toEqual([
      ["Precio alto", "e2", 0],
      ["No sé si alcanza 8 GB", "e1", 0],
    ]);
    expect(out.themes).toEqual([
      { theme: "Batería", count: 5 },
      { theme: "Precio", count: 4 },
    ]);
    expect(out.corrections).toEqual([{ text: "El precio era 999", episodeId: "e1" }]);
    expect(out.ideas).toEqual([{ text: "Comparar con Windows", episodeId: "e2" }]);
  });

  it("arma el enlace al comentario", () => {
    expect(commentUrl("vid1", "Ugx1")).toBe("https://www.youtube.com/watch?v=vid1&lc=Ugx1");
  });
});
