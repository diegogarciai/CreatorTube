import { describe, expect, it } from "vitest";
import { SearchUnavailableError } from "@planificador/ai";
import { parallelConfigFromEnv, parallelSearch } from "../src/lib/parallel";

const config = parallelConfigFromEnv({ PARALLEL_API_KEY: "k", PARALLEL_API_URL: "http://p/" });

describe("buscador Parallel", () => {
  it("lee la configuración del entorno", () => {
    expect(config).toMatchObject({ baseUrl: "http://p", mode: "basic", pricePerSearchUsd: 0.005 });
    expect(() => parallelConfigFromEnv({})).toThrow(/PARALLEL_API_KEY/);
    expect(
      parallelConfigFromEnv({ PARALLEL_API_KEY: "k", PARALLEL_SEARCH_MODE: "fast" }).mode,
    ).toBe("fast");
  });

  it("arma la petición y traduce la respuesta", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          session_id: "s1",
          results: [
            { url: "https://a.com", title: "A", publish_date: "2026-09-01", excerpts: ["x"] },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const search = parallelSearch(config, fetchImpl);
    expect(await search("Objetivo", ["uno", "dos"])).toEqual([
      { url: "https://a.com", title: "A", publishDate: "2026-09-01", excerpts: ["x"] },
    ]);
    await search("Otro", []);
    expect(calls[0]!.url).toBe("http://p/v1/search");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    const first = JSON.parse(calls[0]!.init.body as string);
    expect(first).toMatchObject({
      objective: "Objetivo",
      search_queries: ["uno", "dos"],
      mode: "basic",
      advanced_settings: { max_results: 6, excerpt_settings: { max_chars_per_result: 1500 } },
    });
    // La segunda búsqueda sigue la sesión y, sin consultas, usa el objetivo.
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second).toMatchObject({ session_id: "s1", search_queries: ["Otro"] });
    expect(search.searches()).toBe(2);
  });

  it("tres fallas seguidas detienen la verificación; un acierto reinicia la cuenta", async () => {
    let fail = true;
    const fetchImpl = (async () =>
      fail
        ? new Response("caído", { status: 503 })
        : new Response(JSON.stringify({ results: [] }))) as unknown as typeof fetch;
    const search = parallelSearch(config, fetchImpl);
    await expect(search("a", ["a"])).rejects.toThrow(/503/);
    await expect(search("a", ["a"])).rejects.toThrow(/503/);
    fail = false;
    await expect(search("a", ["a"])).resolves.toEqual([]);
    fail = true;
    await expect(search("a", ["a"])).rejects.toThrow(/503/);
    await expect(search("a", ["a"])).rejects.toThrow(/503/);
    await expect(search("a", ["a"])).rejects.toBeInstanceOf(SearchUnavailableError);
  });
});
