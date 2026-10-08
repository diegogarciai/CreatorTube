import type Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { EPISODE_TYPE_LABELS } from "./direction";
import { isTransientAiError } from "./errors";
import { AiRefusalError, type AiConfig } from "./generate";

/**
 * Guion en etapas (documento "Las 5 etapas del guion"): cada etapa recibe solo
 * sus secciones de la guía y el material de las anteriores, y entrega texto en
 * bloques que empiezan con "### BLOQUE: " y el título exacto.
 */
export const SCRIPT_STAGES = ["study", "script", "verification", "publication", "podcast"] as const;
export type ScriptStage = (typeof SCRIPT_STAGES)[number];

/** Etapas que la app ya genera (las demás llegan en los pasos 5 y 6). */
export const IMPLEMENTED_STAGES: readonly ScriptStage[] = ["study", "script"];

export interface BlockSpec {
  title: string;
  /** Teleprompter, reels y podcast van en texto plano; el resto en Markdown. */
  plain: boolean;
  what: string;
}

export const STAGE_BLOCKS: Partial<Record<ScriptStage, BlockSpec[]>> = {
  study: [
    { title: "DOSSIER DE ESTUDIO", plain: false, what: "el dossier de la sección 4" },
    {
      title: "TARJETAS DE ESTUDIO",
      plain: false,
      what: "las tarjetas de la sección 5, en tabla # | Nivel | Pregunta | Respuesta",
    },
  ],
  script: [
    {
      title: "ESCALETA Y CONTROL DE CALIDAD",
      plain: false,
      what: "sección 8: promesa del clic, tres ganchos con el elegido, escaleta con bucles abiertos y la tabla 8.8 del guion terminado",
    },
    {
      title: "GUION — TELEPROMPTER",
      plain: true,
      what: "secciones 6, 8 y 9: texto plano, sin ninguna marca",
    },
    {
      title: "GUION CON REELS MARCADOS",
      plain: true,
      what: "secciones 13.3 y 9.7: el mismo texto con las marcas de reels e invitaciones",
    },
    {
      title: "VERIFICACIÓN DE DATOS",
      plain: false,
      what: "sección 10, todo en Pendiente",
    },
    {
      title: "MOTION GRAPHICS",
      plain: false,
      what: "una ficha 12.5 por cada párrafo con información importante",
    },
    { title: "PLAN DE B-ROLLS", plain: false, what: "sección 11" },
  ],
};

const STAGE_LABEL: Record<ScriptStage, string> = {
  study: "Estudio",
  script: "Guion",
  verification: "Verificación",
  publication: "Publicación",
  podcast: "Podcast",
};

const STAGE_EFFORT: Record<ScriptStage, "low" | "medium" | "high"> = {
  study: "medium",
  script: "high",
  verification: "high",
  publication: "medium",
  podcast: "medium",
};

// Alias, no interface: se guarda en columnas jsonb.
export type Block = {
  title: string;
  body: string;
};

export interface StageContext {
  /** Secciones de la guía que recibe esta etapa, ya armadas. */
  guideSections: string;
  presenter: string;
  today: string;
  timezone: string;
  episodeCode: string;
  title: string;
  stance: string;
  stanceConfirmed: boolean;
  notes: string;
  pillar: string | null;
  targetMinutes: number;
  episodeType: keyof typeof EPISODE_TYPE_LABELS | null;
  ownMeasurements: string;
  sponsorship: "none" | "sponsor" | "affiliate" | null;
  /** Bloque «DIRECCIÓN DEL EPISODIO»; null si el presentador saltó la entrevista. */
  directionBlock: string | null;
  /** Solo para Guion, Publicación y Podcast. */
  channel: {
    newsletter: string | null;
    nextVideo: { title: string; date: string | null } | null;
    published: {
      title: string;
      date: string | null;
      pillar: string | null;
      keywords: string[];
      stance: string;
    }[];
  } | null;
  previous: { stage: ScriptStage; blocks: Block[] }[];
}

const SYSTEM = `Te llama el panel de planificación del canal (modo panel). Cada llamada es una etapa y dice exactamente qué bloques entregar; esa instrucción manda sobre cualquier otra lista de entregables. No haces preguntas, no generas archivos (PDF, PNG, CSV) y no buscas en la web: entregas todo como texto, dentro de bloques que empiezan con una línea «### BLOQUE: » seguida del título exacto. El teleprompter, los reels y el podcast van en texto plano; el resto, en Markdown.

Aplica al pie de la letra estas instrucciones:

<instrucciones>
{{SECTIONS}}
</instrucciones>`;

const SCRIPT_EXTRA = `Como esta etapa no busca en la web, tiene tres reglas extra:
- La primera línea del bloque de verificación dice «GUION SIN VERIFICAR — NO GRABAR», y cada afirmación lleva la búsqueda exacta y la fuente primaria donde confirmarla.
- Cada afirmación es concreta (sujeto, modelo, año, cifra). Sin cifra, se dice como opinión.
- «DATO: …» solo para lo que no puedes saber, como precios actuales o productos posteriores a tu fecha de corte: máximo 3, cada uno con una sola cosa precisa (modelo, país y moneda).`;

const thousands = (n: number) => n.toLocaleString("es-CO");

export function buildStagePrompt(
  stage: ScriptStage,
  ctx: StageContext,
): { system: string; user: string } {
  const blocks = STAGE_BLOCKS[stage];
  if (!blocks) throw new Error(`La etapa ${stage} todavía no se genera en la app`);
  const n = SCRIPT_STAGES.indexOf(stage) + 1;

  const stance = ctx.stance.trim()
    ? `${ctx.stance.trim()} (${ctx.stanceConfirmed ? `confirmada por ${ctx.presenter}` : "propuesta, sin confirmar"})`
    : "ninguna anotada";
  const sponsorship =
    ctx.sponsorship === "none"
      ? "No"
      : ctx.sponsorship === "sponsor"
        ? "Patrocinio"
        : ctx.sponsorship === "affiliate"
          ? "Afiliados"
          : "sin confirmar";

  const parts: string[] = [
    `ETAPA: ${STAGE_LABEL[stage]} (${n} de 5)`,
    `Fecha de hoy: ${ctx.today} (hora de ${ctx.timezone})`,
    `ID del episodio: ${ctx.episodeCode}`,
    `Duración objetivo: ${ctx.targetMinutes} minutos (unas ${thousands(ctx.targetMinutes * 150)} palabras de guion)`,
    "",
    `TEMA: ${ctx.title}`,
    `POSTURA: ${stance}`,
    `NOTAS DEL PRESENTADOR: ${ctx.notes.trim() || "ninguna"}`,
    `PILAR: ${ctx.pillar ?? "sin pilar"}`,
    "FICHA DE ENTRADA:",
    `- Tipo de episodio: ${ctx.episodeType ? EPISODE_TYPE_LABELS[ctx.episodeType] : "sin definir: elígelo tú"}`,
    `- Mediciones propias: ${ctx.ownMeasurements.trim() || "no hay medición propia"}`,
    `- Patrocinio o afiliados: ${sponsorship}`,
  ];

  if (ctx.channel) {
    parts.push(
      "",
      "CONTEXTO DEL CANAL:",
      `- Nombre del boletín: ${ctx.channel.newsletter || "El Punto"}`,
      `- Próximo video programado: ${
        ctx.channel.nextVideo
          ? `${ctx.channel.nextVideo.title}${ctx.channel.nextVideo.date ? ` (${ctx.channel.nextVideo.date})` : ""}`
          : "ninguno"
      }`,
      "- VIDEOS PUBLICADOS:",
      ...(ctx.channel.published.length
        ? ctx.channel.published.map((v) =>
            [
              `  - ${v.title}`,
              v.date ? ` (${v.date})` : "",
              v.pillar ? ` · pilar: ${v.pillar}` : "",
              v.keywords.length ? ` · búsquedas: ${v.keywords.join(", ")}` : "",
              v.stance ? ` · postura: ${v.stance}` : "",
            ].join(""),
          )
        : ["  - (todavía no hay videos publicados)"]),
    );
  }

  for (const prev of ctx.previous) {
    parts.push("", `MATERIAL DE LA ETAPA ${STAGE_LABEL[prev.stage].toUpperCase()}:`);
    for (const b of prev.blocks) parts.push(`### BLOQUE: ${b.title}`, b.body.trim(), "");
  }

  parts.push(
    "",
    "ENTREGA, en este orden y cada bloque con su línea «### BLOQUE: » y el título exacto:",
    ...blocks.map((b, i) => `${i + 1}. ### BLOQUE: ${b.title} — ${b.what}.`),
  );
  if (stage === "script") parts.push("", SCRIPT_EXTRA);
  parts.push(
    "",
    ctx.directionBlock
      ? `No hagas preguntas: ${ctx.presenter} ya respondió la entrevista de dirección que va al final, y lo que respondió manda.`
      : `No hagas preguntas: ${ctx.presenter} saltó la entrevista de dirección; decide tú con las reglas de siempre.`,
  );
  if (ctx.directionBlock) parts.push("", ctx.directionBlock);

  return {
    system: SYSTEM.replace("{{SECTIONS}}", ctx.guideSections.trim()),
    user: parts.join("\n"),
  };
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[—–-]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[*#:`]/g, "")
    .trim();

const BLOCK_LINE = /^\s*#{2,4}\s*\**\s*BLOQUE\s*:\s*(.+?)\**\s*$/i;

/** Corta la respuesta por las líneas «### BLOQUE: título». */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = BLOCK_LINE.exec(line);
    if (m) {
      if (current) blocks.push({ title: current.title, body: current.lines.join("\n").trim() });
      current = { title: m[1]!.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ title: current.title, body: current.lines.join("\n").trim() });
  return blocks;
}

/** Títulos esperados que no llegaron (o llegaron vacíos). */
export function missingBlocks(stage: ScriptStage, blocks: readonly Block[]): string[] {
  const got = new Map(blocks.map((b) => [norm(b.title), b.body]));
  return (STAGE_BLOCKS[stage] ?? [])
    .filter((spec) => !got.get(norm(spec.title))?.trim())
    .map((spec) => spec.title);
}

/** El bloque esperado con ese título, tolerando acentos y guiones distintos. */
export function findBlock(blocks: readonly Block[], title: string): Block | undefined {
  const t = norm(title);
  return blocks.find((b) => norm(b.title) === t);
}

/**
 * Vista previa de lo que va escribiendo: el bloque en curso y sus últimas
 * líneas con texto (a lo sumo `maxChars`), sin las marcas de bloque.
 */
export function previewTail(text: string, maxLines = 4, maxChars = 480): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  let title = "";
  lines.forEach((line, i) => {
    const m = BLOCK_LINE.exec(line);
    if (m) {
      start = i + 1;
      title = m[1]!.trim();
    }
  });
  const body = lines
    .slice(start)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  let tail = body.slice(-maxLines).join("\n");
  if (tail.length > maxChars) {
    const cut = tail.slice(-maxChars);
    tail = "…" + cut.slice(cut.search(/\s/) + 1);
  }
  return title ? `${title}\n${tail}`.trim() : tail;
}

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export interface StageResult {
  text: string;
  blocks: Block[];
  missing: string[];
  /** La respuesta se cortó por largo o faltan bloques: se puede reintentar. */
  incomplete: boolean;
  usage: UsageTotals;
  model: string;
}

/** Mínimo de la interfaz del SDK que se usa; en las pruebas se inyecta un falso. */
export type StreamClient = Pick<Anthropic, "beta">;

/** Esperas antes de cada reintento cuando Claude está saturado o falla la red. */
export const RETRY_DELAYS_MS = [20_000, 60_000, 120_000];

export interface StageProgress {
  words: number;
  /** Las últimas líneas escritas, para la vista previa en vivo. */
  preview?: string;
  /** Un aviso (p. ej. el reintento) en lugar del conteo de palabras. */
  notice?: string;
}

export interface StageOptions {
  onProgress?: (progress: StageProgress) => void | Promise<void>;
  /** Se inyecta en las pruebas para no esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Llama a una etapa en streaming (salidas largas) y avisa el avance con las
 * palabras escritas. Con `fallbacks`, una negativa se reintenta en el servidor
 * con el modelo de respaldo recomendado. Si Claude está saturado (también a
 * mitad del stream, que el SDK no reintenta), espera y vuelve a empezar.
 */
export async function runStage(
  client: StreamClient,
  config: AiConfig,
  stage: ScriptStage,
  ctx: StageContext,
  { onProgress = () => {}, sleep = wait, retryDelaysMs = RETRY_DELAYS_MS }: StageOptions = {},
): Promise<StageResult> {
  const { system, user } = buildStagePrompt(stage, ctx);
  const attempts = retryDelaysMs.length + 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await streamStage(client, config, stage, system, user, onProgress);
    } catch (err) {
      if (attempt >= attempts || !isTransientAiError(err)) throw err;
      const ms = retryDelaysMs[attempt - 1]!;
      await onProgress({
        words: 0,
        notice: `Claude está saturado; reintento ${attempt + 1} de ${attempts} en ${Math.round(ms / 1000)} s`,
      });
      await sleep(ms);
    }
  }
}

async function streamStage(
  client: StreamClient,
  config: AiConfig,
  stage: ScriptStage,
  system: string,
  user: string,
  onProgress: NonNullable<StageOptions["onProgress"]>,
): Promise<StageResult> {
  const stream = client.beta.messages.stream({
    model: config.model,
    max_tokens: 64_000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    output_config: { effort: STAGE_EFFORT[stage] },
    ...(config.fallbacks && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
  });

  let written = "";
  let lastReport = 0;
  stream.on("text", (delta) => {
    written += delta;
    const now = Date.now();
    if (now - lastReport > 4000) {
      lastReport = now;
      void onProgress({ words: countWords(written), preview: previewTail(written) });
    }
  });

  const final = await stream.finalMessage();
  const usage = addUsage(emptyUsage(), final.usage);
  if (final.stop_reason === "refusal") {
    const details = (final as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new AiRefusalError(details?.category ?? null);
  }
  const text = final.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const blocks = parseBlocks(text);
  const missing = missingBlocks(stage, blocks);
  return {
    text,
    blocks,
    missing,
    incomplete: final.stop_reason === "max_tokens" || missing.length > 0,
    usage,
    model: final.model,
  };
}
