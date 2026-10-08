import { describe, expect, it } from "vitest";
import { APIError } from "@anthropic-ai/sdk";
import {
  blockingClaims,
  needsDecision,
  pauseAfterFix,
  pauseAfterVerify,
  checkEvidence,
  extractClaims,
  normalizeUrl,
  SearchUnavailableError,
  verificationTable,
  verifyGroup,
  type Claim,
  type SearchFn,
} from "../src/verification";

const usage = {
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const claim = (idx: number, over: Partial<Claim> = {}): Claim => ({
  idx,
  kind: "fact",
  claim: `Afirmación ${idx}`,
  line: `Línea ${idx}`,
  occurrences: 1,
  status: "pending",
  nature: null,
  url: null,
  sourceTitle: null,
  quote: null,
  date: null,
  value: null,
  note: "",
  ...over,
});

const raw = (over: Record<string, unknown>) => ({
  id: 1,
  estado: "verificado",
  naturaleza: "marca",
  url: "https://apple.com/mac/",
  cita: "batería de hasta 22 horas",
  fecha: "2026-09-01",
  valor: null,
  nota: "",
  ...over,
});

const found = new Map([
  [
    normalizeUrl("https://www.apple.com/mac"),
    {
      url: "https://www.apple.com/mac",
      title: "Mac",
      date: "2026-09-01",
      text: "El nuevo modelo ofrece una Batería de hasta 22 horas, según Apple.",
    },
  ],
]);

describe("control de fuentes y citas", () => {
  it("normaliza URL", () => {
    expect(normalizeUrl("https://www.Apple.com/mac/#specs")).toBe("apple.com/mac");
    expect(normalizeUrl("http://apple.com/mac")).toBe("apple.com/mac");
  });

  it("acepta URL de la búsqueda con cita textual (sin importar mayúsculas ni acentos)", () => {
    const r = checkEvidence(raw({}), found);
    expect(r).toMatchObject({
      status: "verified",
      nature: "brand",
      url: "https://www.apple.com/mac",
      sourceTitle: "Mac",
      quote: "batería de hasta 22 horas",
    });
  });

  it("rechaza URL inventada, cita que no está o larga, y Contradicho sin fuente", () => {
    expect(checkEvidence(raw({ url: "https://otra.com/x" }), found)).toMatchObject({
      status: "unverifiable",
      url: null,
      note: expect.stringContaining("no salió de la búsqueda"),
    });
    expect(checkEvidence(raw({ cita: "batería de hasta 30 horas" }), found)).toMatchObject({
      status: "unverifiable",
      note: expect.stringContaining("no aparece"),
    });
    expect(
      checkEvidence(
        raw({
          cita: "uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis",
        }),
        found,
      ).status,
    ).toBe("unverifiable");
    expect(checkEvidence(raw({ estado: "contradicho", url: null }), found).status).toBe(
      "unverifiable",
    );
    const contra = checkEvidence(
      raw({ estado: "contradicho", cita: null, nota: "Apple dice 22, no 24" }),
      found,
    );
    expect(contra).toMatchObject({
      status: "contradicted",
      quote: null,
      note: "Apple dice 22, no 24",
    });
  });
});

describe("extracción", () => {
  it("convierte la salida estructurada en afirmaciones pendientes", async () => {
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
                afirmaciones: [
                  {
                    tipo: "hecho",
                    afirmacion: "22 horas de batería",
                    linea: "Este portátil",
                    veces: 2,
                  },
                  { tipo: "opinion", afirmacion: "Vale la pena", linea: "Para mí", veces: 1 },
                  { tipo: "dato", afirmacion: "Precio en EE. UU.", linea: "Cuesta", veces: 0 },
                ],
              },
            };
          },
        },
      },
    } as never;
    const out = await extractClaims(
      client,
      { model: "m" },
      {
        system: "S",
        shared: "C",
        teleprompter: "Texto",
      },
    );
    expect(out.claims.map((c) => [c.idx, c.kind, c.occurrences, c.status])).toEqual([
      [1, "fact", 2, "pending"],
      [2, "opinion", 1, "pending"],
      [3, "dato", 1, "pending"],
    ]);
    const content = (calls[0] as { messages: { content: { text: string }[] }[] }).messages[0]!
      .content;
    expect(content[1]!.text).toBe("### BLOQUE: GUION — TELEPROMPTER\nTexto");
  });
});

describe("ciclo de verificación", () => {
  type Turn = { content: Record<string, unknown>[]; stop_reason?: string } | Error;
  /** Un cliente que responde en orden y guarda cada petición. */
  const fake = (turns: Turn[]) => {
    const calls: { messages: { role: string; content: unknown }[]; tools: { name: string }[] }[] =
      [];
    let n = 0;
    const client = {
      beta: {
        messages: {
          create: async (params: never) => {
            calls.push(structuredClone(params));
            const t = turns[Math.min(n++, turns.length - 1)]!;
            if (t instanceof Error) throw t;
            return { model: "m", stop_reason: "tool_use", usage, ...t };
          },
        },
      },
    } as never;
    return { client, calls };
  };
  const search: SearchFn = async () => [
    {
      url: "https://www.apple.com/mac",
      title: "Mac",
      publishDate: "2026-09-01",
      excerpts: ["El nuevo modelo ofrece una batería de hasta 22 horas."],
    },
  ];
  const buscar = (id: string) => ({
    type: "tool_use",
    id,
    name: "buscar",
    input: { objetivo: "Batería del Mac", consultas: ["mac batería horas"] },
  });
  const registrar = (resultados: unknown[]) => ({
    type: "tool_use",
    id: "r",
    name: "registrar_resultados",
    input: { resultados },
  });

  it("busca, registra y el servidor revisa cada resultado", async () => {
    const { client, calls } = fake([
      { content: [buscar("b1")] },
      {
        content: [
          registrar([
            raw({ id: 1, url: "https://apple.com/mac" }),
            raw({ id: 2, url: "https://inventada.com", cita: "algo" }),
            raw({ id: 9 }),
          ]),
        ],
      },
    ]);
    const out = await verifyGroup(
      client,
      { model: "m", fallbacks: true },
      { system: "S", shared: "C" },
      [claim(1), claim(2)],
      search,
    );
    expect(out.searches).toBe(1);
    expect(out.results.get(1)!.status).toBe("verified");
    expect(out.results.get(2)!.status).toBe("unverifiable");
    expect(out.results.has(9)).toBe(false);
    expect(out.usage.input_tokens).toBe(2000);
    // La segunda petición lleva el resultado de la búsqueda con la URL y el extracto.
    const second = calls[1]!;
    expect(second.tools.map((t) => t.name)).toEqual(["buscar", "registrar_resultados"]);
    const toolResult = (second.messages.at(-1)!.content as { content: string }[])[0]!;
    expect(toolResult.content).toContain("URL: https://www.apple.com/mac");
    expect((calls[0] as unknown as { betas: string[] }).betas).toEqual([
      "server-side-fallback-2026-07-01",
    ]);
  });

  it("si termina sin registrar, se lo pide una vez; si no, todo queda No verificable", async () => {
    const { client, calls } = fake([
      { content: [{ type: "text", text: "listo" }], stop_reason: "end_turn" },
    ]);
    const out = await verifyGroup(
      client,
      { model: "m" },
      { system: "S", shared: "C" },
      [claim(1)],
      search,
    );
    expect(calls).toHaveLength(2);
    expect(out.results.get(1)!.status).toBe("unverifiable");
  });

  it("el buscador caído detiene el grupo; una falla suelta se le avisa a Claude", async () => {
    const down = fake([{ content: [buscar("b1")] }]);
    await expect(
      verifyGroup(
        down.client,
        { model: "m" },
        { system: "S", shared: "C" },
        [claim(1)],
        async () => {
          throw new SearchUnavailableError();
        },
      ),
    ).rejects.toBeInstanceOf(SearchUnavailableError);

    const flaky = fake([
      { content: [buscar("b1")] },
      { content: [registrar([raw({ id: 1, estado: "no_verificable", url: null, cita: null })])] },
    ]);
    await verifyGroup(
      flaky.client,
      { model: "m" },
      { system: "S", shared: "C" },
      [claim(1)],
      async () => {
        throw new Error("timeout");
      },
    );
    const toolResult = (flaky.calls[1]!.messages.at(-1)!.content as { is_error: boolean }[])[0]!;
    expect(toolResult.is_error).toBe(true);
  });

  it("respeta el tope de búsquedas y reintenta si Claude está saturado", async () => {
    const overloaded = new APIError(
      undefined,
      { error: { type: "overloaded_error" } },
      undefined,
      new Headers(),
      "overloaded_error",
    );
    const { client, calls } = fake([
      overloaded,
      { content: [buscar("b1"), buscar("b2")] },
      { content: [registrar([raw({ id: 1 })])] },
    ]);
    const waits: number[] = [];
    const out = await verifyGroup(
      client,
      { model: "m" },
      { system: "S", shared: "C" },
      [claim(1)],
      search,
      {
        maxSearches: 1,
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
    );
    expect(waits).toEqual([20_000]);
    expect(out.searches).toBe(1);
    const results = calls[2]!.messages.at(-1)!.content as { is_error?: boolean }[];
    expect(results[1]!.is_error).toBe(true);
  });
});

describe("tabla", () => {
  it("arma la tabla 10.3 con datos y opiniones aparte, y cuenta lo que bloquea", () => {
    const claims = [
      claim(1, {
        status: "verified",
        nature: "brand",
        url: "https://apple.com/mac",
        sourceTitle: "Mac",
        quote: "hasta 22 horas",
        date: "2026-09-01",
        occurrences: 2,
      }),
      claim(2, { status: "contradicted", note: "La fuente dice 18 | horas" }),
      claim(3, {
        kind: "dato",
        claim: "Precio en EE. UU.",
        status: "verified",
        value: "US$1.299",
        url: "https://apple.com/shop",
        quote: "desde US$1.299",
      }),
      claim(4, { kind: "opinion", claim: "Vale la pena" }),
      claim(5, { kind: "dato", claim: "Fecha de llegada a Colombia", status: "unverifiable" }),
    ];
    const table = verificationTable(claims);
    expect(table).toContain(
      "| 1 | Afirmación 1 (aplica a 2 líneas) | Línea 1 | Verificado | Marca | [Mac](https://apple.com/mac) | «hasta 22 horas» | 2026-09-01 |",
    );
    expect(table).toContain("Contradicho: La fuente dice 18 \\| horas");
    expect(table).toContain("| 3 | Precio en EE. UU. | US$1.299 | Verificado |");
    expect(table).toContain("- Vale la pena — «Línea 4»");
    expect(blockingClaims(claims).map((c) => c.idx)).toEqual([2, 5]);
  });

  it("las decisiones del presentador van al final y solo en filas que las piden", () => {
    expect(needsDecision({ kind: "fact", status: "contradicted" })).toBe(true);
    expect(needsDecision({ kind: "fact", status: "nuanced" })).toBe(false);
    expect(needsDecision({ kind: "dato", status: "unverifiable" })).toBe(true);
    expect(needsDecision({ kind: "dato", status: "verified" })).toBe(false);
    expect(needsDecision({ kind: "opinion", status: "pending" })).toBe(false);
    const table = verificationTable([
      claim(1, { status: "verified", decision: "remove" }),
      claim(2, { status: "contradicted", decision: "remove" }),
      claim(3, { status: "unverifiable", decision: "rewrite" }),
      claim(4, {
        kind: "dato",
        claim: "Precio",
        status: "unverifiable",
        decision: "value",
        decisionValue: "1.099 dólares",
      }),
      claim(5, { status: "unverifiable", decision: "mark" }),
      claim(6, { status: "unverifiable" }),
    ]);
    const section = table.slice(table.indexOf("**Decisiones del presentador"));
    expect(section.split("\n").filter((l) => l.startsWith("- "))).toEqual([
      "- #2 (Afirmación 2): eliminar la línea",
      "- #3 (Afirmación 3): reescribir la línea con lo confirmado",
      "- #4 (Precio): usar el valor «1.099 dólares», que da el presentador",
      "- #5 (Afirmación 5): dejar ___DATO POR CONFIRMAR___",
    ]);
    expect(verificationTable([claim(1, { status: "unverifiable" })])).not.toContain("Decisiones");
  });

  it("pausa tras Verificar con filas sin decidir; tras el guion verificado, salvo ___DATO a propósito", () => {
    const ok = claim(1, { status: "verified" });
    const bad = claim(2, { status: "unverifiable" });
    const dato = claim(3, { kind: "dato", status: "unverifiable" });
    expect(pauseAfterVerify([])).toBe(false);
    expect(pauseAfterVerify([ok])).toBe(false);
    expect(pauseAfterVerify([ok, bad])).toBe(true);
    expect(pauseAfterVerify([{ ...bad, decision: "remove" }])).toBe(false);

    const withDato = "Llega el ___DATO POR CONFIRMAR___.";
    expect(pauseAfterFix("Sin pendientes.", [bad])).toBe(false);
    // Nadie decidió: decide Claude y se revisa antes de seguir.
    expect(pauseAfterFix(withDato, [bad, dato])).toBe(true);
    // Todo decidido y el dato se dejó marcado a propósito: sigue.
    expect(
      pauseAfterFix(withDato, [
        { ...bad, decision: "remove" },
        { ...dato, decision: "mark" },
      ]),
    ).toBe(false);
    // Todo decidido pero ninguno como marcado: el ___DATO salió de otro lado.
    expect(pauseAfterFix(withDato, [{ ...bad, decision: "remove" }])).toBe(true);
    // Una fila quedó en manos de Claude.
    expect(pauseAfterFix(withDato, [bad, { ...dato, decision: "mark" }])).toBe(true);
    expect(pauseAfterFix(withDato, [])).toBe(true);
  });
});
