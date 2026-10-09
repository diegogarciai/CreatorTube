import { describe, expect, it } from "vitest";
import { parseGearList } from "../src";

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

describe("ordenar la lista de equipos", () => {
  it("separa marca, modelo y categoría y descarta lo vacío", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          parse: async (p: Record<string, unknown>) => {
            calls.push(p);
            return {
              model: "m",
              stop_reason: "end_turn",
              usage,
              parsed_output: {
                items: [
                  {
                    name: " DJI Mini 4 Pro ",
                    brand: "DJI",
                    model: "Mini 4 Pro",
                    category: "drone",
                  },
                  { name: "", brand: "", model: "", category: "other" },
                ],
              },
            };
          },
        },
      },
    } as never;
    const out = await parseGearList(client, { model: "m" }, "dji mini 4 pro\nmacbok");
    expect(out.items).toEqual([
      { name: "DJI Mini 4 Pro", brand: "DJI", model: "Mini 4 Pro", category: "drone" },
    ]);
    const msg = String((calls[0]!.messages as { content: string }[])[0]!.content);
    expect(msg).toBe("<lista>\ndji mini 4 pro\nmacbok\n</lista>");
    expect(out.usage.input_tokens).toBe(10);
  });
});
