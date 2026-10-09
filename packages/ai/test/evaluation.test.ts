import { describe, expect, it } from "vitest";
import { compareToBaseline } from "@planificador/core";
import { auditMonth, evaluateEpisode, metricsTable } from "../src";

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function client(answer: unknown) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: {
      beta: {
        messages: {
          parse: async (params: Record<string, unknown>) => {
            calls.push(params);
            return { model: "m", stop_reason: "end_turn", usage, parsed_output: answer };
          },
        },
      },
    } as never,
  };
}

const metrics = compareToBaseline({ views: 1500, ctr: 0.06, averageViewPercentage: 40 }, [
  { views: 1000, ctr: 0.05, averageViewPercentage: 42 },
  { views: 1200, ctr: 0.04, averageViewPercentage: 45 },
]);

describe("evaluación a 7 días", () => {
  it("la tabla muestra valor, mediana, diferencia y cuántos episodios", () => {
    const table = metricsTable(metrics);
    expect(table).toContain("| Vistas | 1500 | 1100 | +36 % | 2 |");
    expect(table).toContain("| CTR | 6.0 % | 4.5 % | +33 % | 2 |");
    expect(table).toContain("| Impresiones | — | — | — | 0 |");
  });

  it("pasa los números y las caídas, y devuelve 3 aprendizajes", async () => {
    const { client: c, calls } = client({
      verdict: "above",
      summary: " Le fue mejor que la mediana. ",
      learnings: ["Uno", " Dos ", "Tres", "Cuatro"],
    });
    const out = await evaluateEpisode(
      c,
      { model: "m" },
      {
        episodeTitle: "MacBook Air M4",
        stance: "Para estudiar alcanza.",
        data: {
          window: { from: "2026-10-01", to: "2026-10-07" },
          metrics,
          baseline: { count: 2, codes: ["E01", "E02"] },
          drops: [{ index: 3, text: "Ahora hablemos del precio", drop: 0.12 }],
        },
      },
    );
    const user = String((calls[0]!.messages as { content: string }[])[0]!.content);
    expect(user).toContain("Comparado con 2 episodios anteriores (E01, E02).");
    expect(user).toContain("Veredicto que sugieren los números: above.");
    expect(user).toContain("- Párrafo 4 (cae 12 %): Ahora hablemos del precio");
    expect(out).toMatchObject({
      verdict: "above",
      summary: "Le fue mejor que la mediana.",
      learnings: ["Uno", "Dos", "Tres"],
    });
    expect(out.usage.input_tokens).toBe(100);
  });
});

describe("auditoría mensual", () => {
  it("junta las evaluaciones y la guía; devuelve hasta 5 propuestas de cada tipo", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      section: `9. GANCHO ${i}`,
      change: "Acortar",
      evidence: "E01",
    }));
    const { client: c, calls } = client({
      summary: "Mes parejo.",
      guide: many,
      topics: [{ topic: "Comparativas", action: "more", evidence: "E01 y E02 arriba" }],
    });
    const out = await auditMonth(
      c,
      { model: "m" },
      {
        month: "2026-10",
        evaluations: [
          {
            code: "E01",
            title: "MacBook Air M4",
            publishedOn: "2026-10-01",
            pillar: "Laptops",
            verdict: "above",
            summary: "Bien.",
            learnings: ["Gancho con cifra"],
            metrics,
            drops: ["Ahora hablemos del precio"],
          },
        ],
        guide: "9. GANCHO\nEmpieza con la cifra.",
        pillars: ["Laptops"],
      },
    );
    const user = String((calls[0]!.messages as { content: string }[])[0]!.content);
    expect(user).toContain("### E01 · MacBook Air M4 (publicado el 2026-10-01, pilar Laptops)");
    expect(user).toContain("Aprendizajes: «Gancho con cifra»");
    expect(user).toContain("## Guía del guionista vigente\n9. GANCHO");
    expect(out.proposals.guide).toHaveLength(5);
    expect(out.proposals.topics[0]).toEqual({
      topic: "Comparativas",
      action: "more",
      evidence: "E01 y E02 arriba",
    });
  });
});
