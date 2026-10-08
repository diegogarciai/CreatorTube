import { describe, expect, it } from "vitest";
import { classifyVideos } from "../src/catalog";

const usage = {
  input_tokens: 900,
  output_tokens: 120,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

describe("clasificación de videos importados", () => {
  it("manda el lote y devuelve pilar del canal, keywords limpias y postura", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          parse: async (params: Record<string, unknown>) => {
            calls.push(params);
            return {
              model: "m",
              stop_reason: "end_turn",
              usage,
              parsed_output: {
                videos: [
                  {
                    id: "a",
                    pilar: "compras",
                    keywords: ["Portátil Nuevo", "portátil nuevo", " mejor portátil "],
                    postura: " Depende del perfil ",
                  },
                  { id: "b", pilar: "Inventado", keywords: [], postura: "" },
                  { id: "a", pilar: "Seguridad", keywords: ["x"], postura: "repetido" },
                  { id: "zzz", pilar: null, keywords: ["no pedido"], postura: "" },
                ],
              },
            };
          },
        },
      },
    } as never;
    const out = await classifyVideos(
      client,
      { model: "m" },
      {
        presenter: "Diego",
        channelName: "Gartechs",
        pillars: [
          { id: "p1", name: "Compras" },
          { id: "p2", name: "Seguridad" },
        ],
        videos: [
          { id: "a", title: "¿Vale la pena?", description: "Texto", tags: ["portátil"] },
          { id: "b", title: "Otro", description: "", tags: [] },
        ],
      },
    );
    expect(out.results).toEqual([
      {
        id: "a",
        pillar: { id: "p1", name: "Compras" },
        keywords: ["portátil nuevo", "mejor portátil"],
        stance: "Depende del perfil",
      },
      { id: "b", pillar: null, keywords: [], stance: "" },
    ]);
    expect(out.usage.input_tokens).toBe(900);
    const params = calls[0] as { system: { text: string }[]; messages: { content: string }[] };
    expect(params.system[0]!.text).toContain("Pilares del canal: Compras, Seguridad.");
    expect(params.messages[0]!.content).toContain(
      "### VIDEO a\nTítulo: ¿Vale la pena?\nEtiquetas: portátil",
    );
    expect(params.messages[0]!.content).toContain("Descripción: (sin descripción)");
  });
});
