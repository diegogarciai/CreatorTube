import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { isTransientAiError } from "./errors";
import { AiRefusalError, type AiConfig } from "./generate";
import { RETRY_DELAYS_MS, type StageOptions, type StreamClient } from "./stages";

/**
 * Verificación (etapa 3, sección 10): se extraen las afirmaciones del guion y
 * se contrastan en la web de 4 en 4. Claude busca con la herramienta `buscar`,
 * que el servidor ejecuta contra Parallel, y entrega cada resultado con
 * `registrar_resultados`. El servidor rechaza toda fuente que no salió de esas
 * búsquedas y toda cita que no aparece en el texto que devolvieron.
 */

export type ClaimKind = "fact" | "opinion" | "dato";
export type ClaimStatus = "pending" | "verified" | "nuanced" | "unverifiable" | "contradicted";
export type ClaimNature = "brand" | "independent" | "own" | "press" | "estimate";

// Alias, no interface: se guarda en jsonb y en filas.
export type Claim = {
  idx: number;
  kind: ClaimKind;
  claim: string;
  line: string;
  occurrences: number;
  status: ClaimStatus;
  nature: ClaimNature | null;
  url: string | null;
  sourceTitle: string | null;
  quote: string | null;
  date: string | null;
  value: string | null;
  note: string;
};

/** Un resultado de búsqueda tal como lo devuelve el buscador. */
export type SearchResult = {
  url: string;
  title: string | null;
  publishDate: string | null;
  excerpts: string[];
};

/** El buscador (Parallel en producción, uno falso en las pruebas). */
export type SearchFn = (objective: string, queries: string[]) => Promise<SearchResult[]>;

/** El buscador falló varias veces seguidas: se detiene con lo avanzado guardado. */
export class SearchUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("El buscador no respondió");
    this.name = "SearchUnavailableError";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------- extracción

const claimsSchema = z.object({
  afirmaciones: z.array(
    z.object({
      tipo: z.enum(["hecho", "opinion", "dato"]),
      afirmacion: z.string().describe("La afirmación tal como hay que verificarla, concreta."),
      linea: z.string().describe("Las primeras palabras de la línea del guion donde está."),
      veces: z.number().int().describe("Cuántas líneas la repiten."),
    }),
  ),
});

const KIND: Record<"hecho" | "opinion" | "dato", ClaimKind> = {
  hecho: "fact",
  opinion: "opinion",
  dato: "dato",
};

export interface ClaimsPrompt {
  system: string;
  shared: string;
  teleprompter: string;
}

/** Pide las afirmaciones con salida estructurada (sección 10.1). */
export async function extractClaims(
  client: StreamClient,
  config: AiConfig,
  prompt: ClaimsPrompt,
): Promise<{ claims: Claim[]; usage: UsageTotals; model: string }> {
  const cache = { type: "ephemeral" as const };
  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 16_000,
    system: [{ type: "text", text: prompt.system, cache_control: cache }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt.shared, cache_control: cache },
          { type: "text", text: `### BLOQUE: GUION — TELEPROMPTER\n${prompt.teleprompter.trim()}` },
          {
            type: "text",
            text: [
              "PASO 1 de 6. Recorre el guion de arriba línea por línea y extrae toda afirmación verificable (10.1).",
              "- «hecho»: cifras, fechas, precios, especificaciones, versiones, comparaciones, superlativos, atribuciones y relaciones causales técnicas. Si un dato se repite, va una vez con las veces que aparece.",
              "- «opinion»: lo que es criterio del presentador (10.6). No se busca en la web.",
              "- «dato»: cada marca ___DATO…___ que quedó en el guion, con lo que pide.",
              "Los datos del canal y del presentador no se buscan: no los incluyas.",
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(claimsSchema),
    },
  });
  if (res.stop_reason === "refusal") throw refusal(res);
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("La extracción de afirmaciones llegó incompleta");
  return {
    claims: parsed.afirmaciones.map((a, i) => ({
      idx: i + 1,
      kind: KIND[a.tipo],
      claim: a.afirmacion.trim(),
      line: a.linea.trim(),
      occurrences: Math.max(1, a.veces),
      status: "pending",
      nature: null,
      url: null,
      sourceTitle: null,
      quote: null,
      date: null,
      value: null,
      note: "",
    })),
    usage: addUsage(emptyUsage(), res.usage),
    model: res.model,
  };
}

// ---------------------------------------------------------------- verificación

const STATUS: Record<string, ClaimStatus> = {
  verificado: "verified",
  con_matiz: "nuanced",
  no_verificable: "unverifiable",
  contradicho: "contradicted",
};
const NATURE: Record<string, ClaimNature> = {
  marca: "brand",
  medicion_independiente: "independent",
  medicion_propia: "own",
  prensa: "press",
  estimacion: "estimate",
};

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "buscar",
    description:
      "Busca en la web. Devuelve resultados con URL, título, fecha y extractos del texto de cada página. Solo valen como fuente las URL y el texto que devuelva esta herramienta.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        objetivo: {
          type: "string",
          description: "Qué quieres confirmar, en una frase completa con el contexto.",
        },
        consultas: {
          type: "array",
          items: { type: "string" },
          description: "De 1 a 3 búsquedas cortas, de 3 a 6 palabras cada una.",
        },
      },
      required: ["objetivo", "consultas"],
    },
  },
  {
    name: "registrar_resultados",
    description:
      "Entrega el resultado de cada afirmación del grupo, una sola vez y al final, cuando ya buscaste todo.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        resultados: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "integer" },
              estado: {
                type: "string",
                enum: ["verificado", "con_matiz", "no_verificable", "contradicho"],
              },
              naturaleza: {
                type: "string",
                enum: [
                  "marca",
                  "medicion_independiente",
                  "medicion_propia",
                  "prensa",
                  "estimacion",
                  "ninguna",
                ],
              },
              url: { type: ["string", "null"], description: "URL exacta de un resultado." },
              cita: {
                type: ["string", "null"],
                description: "Hasta 15 palabras copiadas textualmente del extracto de esa URL.",
              },
              fecha: { type: ["string", "null"], description: "Fecha del dato o de la fuente." },
              valor: {
                type: ["string", "null"],
                description: "Solo para ___DATO: el valor confirmado, con unidad, país y moneda.",
              },
              nota: {
                type: "string",
                description: "El matiz, lo que dice la fuente si contradice, o por qué no se pudo.",
              },
            },
            required: ["id", "estado", "naturaleza", "url", "cita", "fecha", "valor", "nota"],
          },
        },
      },
      required: ["resultados"],
    },
  },
];

type Found = { url: string; title: string | null; date: string | null; text: string };

/** URL comparables: sin esquema, www, barra final ni fragmento. */
export function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/#.*$/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Texto comparable: minúsculas, sin acentos ni puntuación, espacios simples. */
function plainText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%$.,]+/gu, " ")
    .replace(/[.,](?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

type RawResult = {
  id: number;
  estado: string;
  naturaleza: string | null;
  url: string | null;
  cita: string | null;
  fecha: string | null;
  valor: string | null;
  nota: string;
};

/**
 * Lo que impone el servidor (10.3): Verificado y Con matiz exigen una URL que
 * salió de las búsquedas de este grupo y una cita de hasta 15 palabras que
 * aparece en su texto; Contradicho exige la URL. Si no, queda No verificable.
 */
export function checkEvidence(
  r: RawResult,
  found: ReadonlyMap<string, Found>,
): Pick<Claim, "status" | "nature" | "url" | "sourceTitle" | "quote" | "date" | "value" | "note"> {
  let status = STATUS[r.estado] ?? "unverifiable";
  let note = r.nota.trim();
  const source = r.url ? found.get(normalizeUrl(r.url)) : undefined;
  const reject = (why: string) => {
    status = "unverifiable";
    note = [why, note].filter(Boolean).join(" ");
  };
  if (status === "verified" || status === "nuanced") {
    if (!source) reject("La fuente no salió de la búsqueda.");
    else if (!r.cita?.trim() || words(r.cita) > 15) reject("Falta una cita de hasta 15 palabras.");
    else if (!plainText(source.text).includes(plainText(r.cita))) {
      reject("La cita no aparece en el texto de la fuente.");
    }
  } else if (status === "contradicted" && !source) {
    reject("La fuente no salió de la búsqueda.");
  }
  const ok = status !== "unverifiable";
  return {
    status,
    nature: ok && r.naturaleza ? (NATURE[r.naturaleza] ?? null) : null,
    url: ok && source ? source.url : null,
    sourceTitle: ok && source ? source.title : null,
    quote: ok && status !== "contradicted" ? (r.cita?.trim() ?? null) : null,
    date: r.fecha?.trim() || source?.date || null,
    value: status === "verified" || status === "nuanced" ? (r.valor?.trim() ?? null) : null,
    note,
  };
}

function formatResults(results: SearchResult[], maxChars: number): string {
  if (!results.length) return "Sin resultados. Prueba otras palabras.";
  return results
    .map((r, i) => {
      const text = r.excerpts.join("\n").slice(0, maxChars);
      return `[${i + 1}] ${r.title ?? "(sin título)"}\nURL: ${r.url}\nFecha: ${r.publishDate ?? "sin fecha"}\n${text}`;
    })
    .join("\n\n");
}

export interface VerifyOptions extends StageOptions {
  /** Tope de búsquedas por grupo. */
  maxSearches?: number;
  /** Caracteres por resultado que ve Claude. */
  maxCharsPerResult?: number;
}

export interface VerifyResult {
  results: Map<number, ReturnType<typeof checkEvidence>>;
  searches: number;
  usage: UsageTotals;
  model: string;
}

/**
 * Verifica un grupo de afirmaciones (hasta 4 hechos, o un ___DATO). Corre el
 * ciclo de herramientas: busca, lee y al final registra.
 */
export async function verifyGroup(
  client: StreamClient,
  config: AiConfig,
  prompt: { system: string; shared: string },
  group: readonly Claim[],
  search: SearchFn,
  {
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    retryDelaysMs = RETRY_DELAYS_MS,
    maxSearches = 8,
    maxCharsPerResult = 1500,
  }: VerifyOptions = {},
): Promise<VerifyResult> {
  const cache = { type: "ephemeral" as const };
  const isDato = group.every((c) => c.kind === "dato");
  const list = group.map((c) => `ID ${c.idx}: ${c.claim}\n   Línea: «${c.line}»`).join("\n");
  const task = [
    isDato
      ? "Completa este ___DATO del guion buscando en la web: el valor exacto, con unidad, país y moneda si aplica, y su fuente."
      : `Verifica estas ${group.length} afirmaciones del guion buscando en la web (10.2), con la jerarquía de fuentes de la sección 10.`,
    "",
    list,
    "",
    "Reglas del panel:",
    "- Usa `buscar` para cada afirmación; nunca respondas de memoria.",
    "- Verificado o Con matiz solo con una URL que haya devuelto `buscar` y una cita de hasta 15 palabras copiada textualmente de su extracto. Si no la tienes, es No verificable.",
    "- Contradicho, con la URL que dice algo distinto y en la nota qué dice.",
    "- Datos que caducan (precios, disponibilidad, versiones): si la fuente tiene más de 3 meses, Con matiz (10.5).",
    "- Al final llama `registrar_resultados` una sola vez con todos los ID.",
  ].join("\n");

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt.shared, cache_control: cache },
        { type: "text", text: task },
      ],
    },
  ];
  const found = new Map<string, Found>();
  let usage = emptyUsage();
  let searches = 0;
  let model = config.model;
  let nudged = false;

  for (let round = 0; round < maxSearches + 4; round++) {
    const res = await withRetries(
      () =>
        client.beta.messages.create({
          model: config.model,
          max_tokens: 16_000,
          system: [{ type: "text", text: prompt.system, cache_control: cache }],
          messages,
          tools: TOOLS,
          output_config: { effort: "medium" },
          ...(config.fallbacks && {
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default" as const,
          }),
        } as Anthropic.Beta.MessageCreateParamsNonStreaming),
      sleep,
      retryDelaysMs,
    );
    usage = addUsage(usage, res.usage);
    model = res.model;
    if (res.stop_reason === "refusal") throw refusal(res);
    messages.push({
      role: "assistant",
      content: res.content as Anthropic.Beta.BetaContentBlockParam[],
    });

    const uses = res.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    const final = uses.find((u) => u.name === "registrar_resultados");
    if (final) {
      const raw = (final.input as { resultados?: RawResult[] }).resultados ?? [];
      const results = new Map<number, ReturnType<typeof checkEvidence>>();
      for (const r of raw) {
        if (group.some((c) => c.idx === r.id)) results.set(r.id, checkEvidence(r, found));
      }
      return { results, searches, usage, model };
    }

    if (!uses.length) {
      // Terminó sin registrar: se le pide una vez más.
      if (nudged) break;
      nudged = true;
      messages.push({
        role: "user",
        content: "Llama `registrar_resultados` con el resultado de cada ID.",
      });
      continue;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      if (use.name !== "buscar") {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: "Herramienta desconocida.",
          is_error: true,
        });
        continue;
      }
      if (searches >= maxSearches) {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content:
            "Ya no quedan búsquedas para este grupo: registra los resultados con lo que tienes.",
          is_error: true,
        });
        continue;
      }
      const input = use.input as { objetivo: string; consultas: string[] };
      searches++;
      try {
        const out = await search(input.objetivo, input.consultas.slice(0, 3));
        for (const r of out) {
          const key = normalizeUrl(r.url);
          const prev = found.get(key);
          const text = r.excerpts.join("\n");
          found.set(key, {
            url: r.url,
            title: r.title,
            date: r.publishDate,
            text: prev ? `${prev.text}\n${text}` : text,
          });
        }
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: formatResults(out, maxCharsPerResult),
        });
      } catch (err) {
        if (err instanceof SearchUnavailableError) throw err;
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: "El buscador falló en esta consulta. Intenta con otras palabras.",
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
  // Sin registro: todo el grupo queda No verificable.
  return {
    results: new Map(
      group.map((c) => [
        c.idx,
        checkEvidence(
          {
            id: c.idx,
            estado: "no_verificable",
            naturaleza: null,
            url: null,
            cita: null,
            fecha: null,
            valor: null,
            nota: "La verificación no entregó resultado.",
          },
          found,
        ),
      ]),
    ),
    searches,
    usage,
    model,
  };
}

async function withRetries<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  delays: readonly number[],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length || !isTransientAiError(err)) throw err;
      await sleep(delays[attempt]!);
    }
  }
}

function refusal(res: { stop_details?: unknown }) {
  const details = res.stop_details as { category?: string | null } | null | undefined;
  return new AiRefusalError(details?.category ?? null);
}

// ---------------------------------------------------------------- tabla

const STATUS_LABEL: Record<ClaimStatus, string> = {
  pending: "Pendiente",
  verified: "Verificado",
  nuanced: "Con matiz",
  unverifiable: "No verificable",
  contradicted: "Contradicho",
};
const NATURE_LABEL: Record<ClaimNature, string> = {
  brand: "Marca",
  independent: "Medición independiente",
  own: "Medición propia",
  press: "Prensa",
  estimate: "Estimación",
};

const cell = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim() || "—";

/** La tabla de la sección 10.3, con los ___DATO y las opiniones aparte. */
export function verificationTable(claims: readonly Claim[]): string {
  const facts = claims.filter((c) => c.kind === "fact");
  const datos = claims.filter((c) => c.kind === "dato");
  const opinions = claims.filter((c) => c.kind === "opinion");
  const out: string[] = [];
  out.push(
    "| # | Afirmación del guion | Línea (primeras palabras) | Estado | Naturaleza | Fuente (enlace) | Cita de la fuente | Fecha del dato |",
    "|---|---|---|---|---|---|---|---|",
    ...facts
      .map((c) =>
        [
          c.idx,
          cell(c.occurrences > 1 ? `${c.claim} (aplica a ${c.occurrences} líneas)` : c.claim),
          cell(c.line),
          STATUS_LABEL[c.status] + (c.note && c.status !== "verified" ? `: ${cell(c.note)}` : ""),
          c.nature ? NATURE_LABEL[c.nature] : "—",
          c.url ? `[${cell(c.sourceTitle ?? c.url)}](${c.url})` : "—",
          c.quote ? `«${cell(c.quote)}»` : "—",
          cell(c.date),
        ].join(" | "),
      )
      .map((row) => `| ${row} |`),
  );
  if (datos.length) {
    out.push(
      "",
      "**Datos por confirmar (___DATO)**",
      "",
      "| # | Qué pide | Valor | Estado | Fuente (enlace) | Cita | Fecha |",
      "|---|---|---|---|---|---|---|",
      ...datos.map(
        (c) =>
          `| ${c.idx} | ${cell(c.claim)} | ${cell(c.value)} | ${STATUS_LABEL[c.status]}${c.note && c.status !== "verified" ? `: ${cell(c.note)}` : ""} | ${c.url ? `[${cell(c.sourceTitle ?? c.url)}](${c.url})` : "—"} | ${c.quote ? `«${cell(c.quote)}»` : "—"} | ${cell(c.date)} |`,
      ),
    );
  }
  if (opinions.length) {
    out.push(
      "",
      "**Opiniones (10.6: no se buscan; deben sonar a opinión)**",
      "",
      ...opinions.map((c) => `- ${cell(c.claim)} — «${cell(c.line)}»`),
    );
  }
  return out.join("\n");
}

/** Cuántas quedan por resolver para la regla de bloqueo (10.4). */
export function blockingClaims(claims: readonly Claim[]): Claim[] {
  return claims.filter(
    (c) =>
      c.kind !== "opinion" &&
      (c.status === "unverifiable" || c.status === "contradicted" || c.status === "pending"),
  );
}
