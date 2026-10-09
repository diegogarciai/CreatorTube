import { describe, expect, it } from "vitest";
import { writeSocialPosts } from "../src";

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

const input = {
  episodeTitle: "MacBook Air M4",
  stance: "Para estudiar alcanza con 16 GB.",
  script: "La batería duró 18 horas.",
  reels: "R1 · La batería que no se acaba",
  claims: [],
  guide: "13. REELS",
  networks: [
    { network: "x", label: "X" },
    { network: "linkedin", label: "LinkedIn" },
  ],
};

const three = (network: string, text = (k: string) => `${network} ${k}`) =>
  ["dato", "mito", "postura"].map((kind) => ({ network, kind, text: text(kind) }));

describe("posts para redes", () => {
  it("3 cápsulas por red pedida, sin repetidas ni redes ajenas", async () => {
    const { client: c, calls } = client([
      {
        posts: [
          ...three("x"),
          ...three("linkedin"),
          { network: "x", kind: "dato", text: "repetido" },
          { network: "tiktok", kind: "dato", text: "ajena" },
        ],
      },
    ]);
    const out = await writeSocialPosts(c, { model: "m" }, input);
    expect(calls).toHaveLength(1);
    const user = String((calls[0]!.messages as { content: string }[])[0]!.content);
    expect(user).toContain("- x (X): 255 caracteres como máximo; 1 hashtags como máximo.");
    expect(user).toContain("Para estudiar alcanza con 16 GB.");
    expect(user).toContain("R1 · La batería que no se acaba");
    expect(out.posts.map((p) => `${p.network}:${p.kind}:${p.text}`)).toEqual([
      "x:dato:x dato",
      "x:mito:x mito",
      "x:postura:x postura",
      "linkedin:dato:linkedin dato",
      "linkedin:mito:linkedin mito",
      "linkedin:postura:linkedin postura",
    ]);
    expect(out.repaired).toBe(0);
    expect(out.usage.input_tokens).toBe(100);
  });

  it("corrige una vez los que se pasan (el enlace ya descontado) y suma el consumo", async () => {
    const long = "a".repeat(270);
    const { client: c, calls } = client([
      { posts: [...three("x", (k) => (k === "mito" ? long : `ok ${k} 🔥`))] },
      {
        posts: [
          { network: "x", kind: "mito", text: "Corto" },
          { network: "x", kind: "postura", text: "Sin emoji" },
        ],
      },
    ]);
    const out = await writeSocialPosts(
      c,
      { model: "m" },
      { ...input, networks: [{ network: "x", label: "X" }] },
    );
    expect(calls).toHaveLength(2);
    const fix = String((calls[1]!.messages as { content: string }[])[0]!.content);
    expect(fix).toContain("con el enlace; el tope en X es 280");
    expect(out.posts.map((p) => p.text)).toEqual(["ok dato 🔥", "Corto", "Sin emoji"]);
    expect(out.repaired).toBe(2);
    expect(out.usage.input_tokens).toBe(200);
  });
});
