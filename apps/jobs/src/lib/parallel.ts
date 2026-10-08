import { SearchUnavailableError, type SearchFn, type SearchResult } from "@planificador/ai";

/**
 * Buscador de la verificación: la API de búsqueda de Parallel. Cada llamada
 * es una búsqueda; si fallan 3 seguidas, la verificación se detiene con lo
 * avanzado guardado (documento de etapas, Verificación, punto 4).
 */
export interface ParallelConfig {
  apiKey: string;
  baseUrl: string;
  /** turbo, fast, basic o advanced. */
  mode: string;
  maxResults: number;
  maxCharsPerResult: number;
  /** Costo de cada búsqueda en dólares, para los créditos. */
  pricePerSearchUsd: number;
}

export function parallelConfigFromEnv(env: Record<string, string | undefined>): ParallelConfig {
  const apiKey = env.PARALLEL_API_KEY?.trim();
  if (!apiKey)
    throw new Error("Falta PARALLEL_API_KEY en las variables de entorno del motor de tareas");
  return {
    apiKey,
    baseUrl: (env.PARALLEL_API_URL?.trim() || "https://api.parallel.ai").replace(/\/+$/, ""),
    mode: env.PARALLEL_SEARCH_MODE?.trim() || "basic",
    maxResults: 6,
    maxCharsPerResult: 1500,
    pricePerSearchUsd: Number(env.PARALLEL_PRICE_USD ?? "") || 0.005,
  };
}

type ParallelResponse = {
  results?: {
    url: string;
    title?: string | null;
    publish_date?: string | null;
    excerpts?: string[];
  }[];
};

export function parallelSearch(
  config: ParallelConfig,
  fetchImpl: typeof fetch = fetch,
): SearchFn & { searches: () => number } {
  let failures = 0;
  let count = 0;
  let sessionId: string | undefined;
  const fn = async (objective: string, queries: string[]): Promise<SearchResult[]> => {
    count++;
    try {
      const res = await fetchImpl(`${config.baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.apiKey },
        body: JSON.stringify({
          objective,
          search_queries: queries.length ? queries : [objective],
          mode: config.mode,
          ...(sessionId && { session_id: sessionId }),
          advanced_settings: {
            max_results: config.maxResults,
            excerpt_settings: { max_chars_per_result: config.maxCharsPerResult },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Parallel respondió ${res.status}`);
      const data = (await res.json()) as ParallelResponse & { session_id?: string };
      sessionId = data.session_id ?? sessionId;
      failures = 0;
      return (data.results ?? []).map((r) => ({
        url: r.url,
        title: r.title ?? null,
        publishDate: r.publish_date ?? null,
        excerpts: r.excerpts ?? [],
      }));
    } catch (err) {
      failures++;
      if (failures >= 3) throw new SearchUnavailableError(err);
      throw err;
    }
  };
  return Object.assign(fn, { searches: () => count });
}
