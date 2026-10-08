/**
 * Costo real de cada llamada, para el registro de créditos (1 crédito = US$0,01).
 * Los precios por millón de tokens se configuran en el entorno del motor de
 * tareas junto con el modelo; leer de la caché cuesta la décima parte y
 * escribirla, 1,25 veces la entrada.
 */
export interface Prices {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export const emptyUsage = (): UsageTotals => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

export function addUsage(
  a: UsageTotals,
  b: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
): UsageTotals {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: a.cache_read_input_tokens + (b.cache_read_input_tokens ?? 0),
  };
}

export function usageCostUsd(u: UsageTotals, p: Prices): number {
  const input =
    u.input_tokens * p.inputPerMTok +
    u.cache_creation_input_tokens * p.inputPerMTok * 1.25 +
    u.cache_read_input_tokens * p.inputPerMTok * 0.1;
  return (input + u.output_tokens * p.outputPerMTok) / 1_000_000;
}

/** Créditos con dos decimales (1 crédito = US$0,01). */
export const usdToCredits = (usd: number) => Math.round(usd * 10_000) / 100;

export function pricesFromEnv(env: Record<string, string | undefined>): Prices {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    inputPerMTok: num(env.AI_PRICE_INPUT_USD, 2),
    outputPerMTok: num(env.AI_PRICE_OUTPUT_USD, 10),
  };
}
