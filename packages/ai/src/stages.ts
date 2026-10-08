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

/**
 * Cada etapa se genera por pasos: una llamada por bloque, en orden, y cada paso
 * recibe los bloques que ya quedaron listos. Así el control de calidad revisa
 * el guion terminado y los reels, la verificación, los motion graphics y los
 * B-rolls salen del teleprompter ya escrito.
 */
export const SCRIPT_STEPS = [
  "dossier",
  "cards",
  "outline",
  "teleprompter",
  "quality",
  "revision",
  "reels",
  "fact_check",
  "motion",
  "broll",
] as const;
export type ScriptStep = (typeof SCRIPT_STEPS)[number];

export interface StepSpec {
  key: ScriptStep;
  stage: ScriptStage;
  title: string;
  /** Teleprompter, reels y podcast van en texto plano; el resto en Markdown. */
  plain: boolean;
  what: string;
  effort: "low" | "medium" | "high";
}

const step = (
  key: ScriptStep,
  stage: ScriptStage,
  title: string,
  what: string,
  { plain = false, effort = "medium" as StepSpec["effort"] } = {},
): StepSpec => ({ key, stage, title, plain, what, effort });

export const STAGE_STEPS: Partial<Record<ScriptStage, StepSpec[]>> = {
  study: [
    step("dossier", "study", "DOSSIER DE ESTUDIO", "el dossier de la sección 4"),
    step(
      "cards",
      "study",
      "TARJETAS DE ESTUDIO",
      "las tarjetas de la sección 5 sobre el dossier de arriba, en tabla # | Nivel | Pregunta | Respuesta",
    ),
  ],
  script: [
    step(
      "outline",
      "script",
      "ESCALETA",
      "sección 8: tipo de episodio, promesa del clic, tres ganchos candidatos con el elegido y la escaleta con sus bucles abiertos. Sin la tabla 8.8: el control de calidad es un paso aparte, después del teleprompter",
      { effort: "high" },
    ),
    step(
      "teleprompter",
      "script",
      "GUION — TELEPROMPTER",
      "secciones 6, 8 y 9: el guion completo según la escaleta de arriba, en texto plano y sin ninguna marca",
      { plain: true, effort: "high" },
    ),
    step(
      "quality",
      "script",
      "CONTROL DE CALIDAD",
      "la tabla 8.8 aplicada al teleprompter de arriba, criterio por criterio con Cumple o No cumple; por cada No cumple, la frase exacta que hay que cambiar y cómo. Termina con una sola línea: «VEREDICTO: CUMPLE» si todo cumple, o «VEREDICTO: CORREGIR» si algo no cumple",
    ),
    step(
      "revision",
      "script",
      "GUION — TELEPROMPTER CORREGIDO",
      "el teleprompter de arriba con cada cambio que pide el control de calidad aplicado, y nada más: conserva todo lo que cumple. Texto plano, sin ninguna marca",
      { plain: true, effort: "high" },
    ),
    step(
      "reels",
      "script",
      "GUION CON REELS MARCADOS",
      "secciones 13.3 y 9.7: el texto del teleprompter de arriba, palabra por palabra, con las marcas de reels e invitaciones",
      { plain: true },
    ),
    step(
      "fact_check",
      "script",
      "VERIFICACIÓN DE DATOS",
      "sección 10: una fila por cada afirmación del teleprompter de arriba, todo en Pendiente",
    ),
    step(
      "motion",
      "script",
      "MOTION GRAPHICS",
      "una ficha 12.5 por cada párrafo del teleprompter de arriba con información importante",
    ),
    step("broll", "script", "PLAN DE B-ROLLS", "sección 11, sobre el teleprompter de arriba"),
  ],
};

const SPECS = new Map(
  Object.values(STAGE_STEPS)
    .flat()
    .map((spec) => [spec.key, spec]),
);

export function stepSpec(key: ScriptStep): StepSpec {
  const spec = SPECS.get(key);
  if (!spec) throw new Error(`El paso ${key} no existe`);
  return spec;
}

/** Lo que dice el control de calidad: todo cumple, o hay que corregir. */
export function qualityVerdict(body: string): "pass" | "fix" {
  const m = /VEREDICTO\s*:\s*\**\s*(CUMPLE|CORREGIR)/i.exec(body);
  if (m) return m[1]!.toUpperCase() === "CUMPLE" ? "pass" : "fix";
  return /no\s+cumple/i.test(body) ? "fix" : "pass";
}

/** Textos de los pasos ya listos, por clave. */
export type StepBodies = Partial<Record<ScriptStep, string>>;

/** La Corrección se salta cuando el control de calidad no encontró nada. */
export function skipsStep(key: ScriptStep, bodies: StepBodies): boolean {
  return key === "revision" && qualityVerdict(bodies.quality ?? "") === "pass";
}

const AFTER_REVISION: readonly ScriptStep[] = ["reels", "fact_check", "motion", "broll"];

/**
 * Los bloques de la misma etapa que recibe un paso. Desde Reels en adelante el
 * teleprompter es el final (el corregido, si lo hay) y la tabla de calidad ya
 * no va: sus cambios quedaron aplicados.
 */
export function stepInputs(key: ScriptStep, bodies: StepBodies): Block[] {
  const spec = stepSpec(key);
  const steps = STAGE_STEPS[spec.stage]!;
  const before = steps.slice(0, steps.indexOf(spec));
  if (!AFTER_REVISION.includes(key)) {
    return before.flatMap((s) =>
      bodies[s.key]?.trim() ? [{ title: s.title, body: bodies[s.key]! }] : [],
    );
  }
  return before.flatMap((s): Block[] => {
    if (s.key === "quality" || s.key === "revision") return [];
    if (s.key === "teleprompter") {
      const body = bodies.revision?.trim() ? bodies.revision : bodies.teleprompter;
      return body?.trim() ? [{ title: s.title, body }] : [];
    }
    return bodies[s.key]?.trim() ? [{ title: s.title, body: bodies[s.key]! }] : [];
  });
}

/**
 * Los bloques que una etapa entrega a las siguientes, en orden: el
 * teleprompter es el final y la corrección no va aparte.
 */
export function stageBlocks(stage: ScriptStage, bodies: StepBodies): Block[] {
  return (STAGE_STEPS[stage] ?? []).flatMap((s): Block[] => {
    if (s.key === "revision") return [];
    const body =
      s.key === "teleprompter" && bodies.revision?.trim() ? bodies.revision : bodies[s.key];
    return body?.trim() ? [{ title: s.title, body }] : [];
  });
}

/** Los pasos que la app genera, en orden, desde el primero de Estudio. */
export const IMPLEMENTED_STEPS: readonly StepSpec[] = IMPLEMENTED_STAGES.flatMap(
  (stage) => STAGE_STEPS[stage] ?? [],
);

export const isScriptStep = (v: unknown): v is ScriptStep =>
  typeof v === "string" && SPECS.has(v as ScriptStep);

const STAGE_LABEL: Record<ScriptStage, string> = {
  study: "Estudio",
  script: "Guion",
  verification: "Verificación",
  publication: "Publicación",
  podcast: "Podcast",
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

const SYSTEM = `Te llama el panel de planificación del canal (modo panel). Cada llamada es un paso de una etapa y dice exactamente qué bloque entregar; esa instrucción manda sobre cualquier otra lista de entregables. No haces preguntas, no generas archivos (PDF, PNG, CSV) y no buscas en la web: entregas todo como texto, dentro de bloques que empiezan con una línea «### BLOQUE: » seguida del título exacto. El teleprompter, los reels y el podcast van en texto plano; el resto, en Markdown.

Aplica al pie de la letra estas instrucciones:

<instrucciones>
{{SECTIONS}}
</instrucciones>`;

const SCRIPT_EXTRA = `Como esta etapa no busca en la web, tiene tres reglas extra:
- La primera línea del bloque de verificación dice «GUION SIN VERIFICAR — NO GRABAR», y cada afirmación lleva la búsqueda exacta y la fuente primaria donde confirmarla.
- Cada afirmación es concreta (sujeto, modelo, año, cifra). Sin cifra, se dice como opinión.
- «DATO: …» solo para lo que no puedes saber, como precios actuales o productos posteriores a tu fecha de corte: máximo 3, cada uno con una sola cosa precisa (modelo, país y moneda).`;

const thousands = (n: number) => n.toLocaleString("es-CO");

export interface StepPrompt {
  system: string;
  /** Lo común a todos los pasos de la etapa (se cachea). */
  shared: string;
  /** Los bloques de esta etapa que ya quedaron listos, en orden. */
  done: Block[];
  /** Qué entrega este paso. */
  task: string;
}

export function buildStepPrompt(
  key: ScriptStep,
  ctx: StageContext,
  done: readonly Block[] = [],
): StepPrompt {
  const spec = stepSpec(key);
  const { stage } = spec;
  const steps = STAGE_STEPS[stage]!;
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
    `Esta etapa se genera por pasos, una llamada por bloque y en este orden: ${steps
      .map((s) => s.title)
      .join(", ")}. Cada llamada entrega solo el bloque que se le pide.`,
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

  if (stage === "script") parts.push("", SCRIPT_EXTRA);
  parts.push(
    "",
    ctx.directionBlock
      ? `No hagas preguntas: ${ctx.presenter} ya respondió la entrevista de dirección que va a continuación, y lo que respondió manda.`
      : `No hagas preguntas: ${ctx.presenter} saltó la entrevista de dirección; decide tú con las reglas de siempre.`,
  );
  if (ctx.directionBlock) parts.push("", ctx.directionBlock);

  const position = steps.indexOf(spec);
  const task = [
    done.length ? "Arriba están los bloques de esta etapa que ya quedaron listos." : "",
    `PASO ${position + 1} de ${steps.length}. ENTREGA solo este bloque, con su línea «### BLOQUE: » y el título exacto:`,
    `### BLOQUE: ${spec.title} — ${spec.what}.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: SYSTEM.replace("{{SECTIONS}}", ctx.guideSections.trim()),
    shared: parts.join("\n"),
    done: [...done],
    task,
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

export interface StepResult {
  text: string;
  block: Block;
  /** La respuesta se cortó por largo o llegó vacía: se puede reintentar. */
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
 * Llama a un paso en streaming y avisa el avance con las palabras escritas y
 * la vista previa. Con `fallbacks`, una negativa se reintenta en el servidor
 * con el modelo de respaldo recomendado. Si Claude está saturado (también a
 * mitad del stream, que el SDK no reintenta), espera y vuelve a empezar.
 */
export async function runStep(
  client: StreamClient,
  config: AiConfig,
  key: ScriptStep,
  ctx: StageContext,
  done: readonly Block[],
  { onProgress = () => {}, sleep = wait, retryDelaysMs = RETRY_DELAYS_MS }: StageOptions = {},
): Promise<StepResult> {
  const prompt = buildStepPrompt(key, ctx, done);
  const attempts = retryDelaysMs.length + 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await streamStep(client, config, key, prompt, onProgress);
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

async function streamStep(
  client: StreamClient,
  config: AiConfig,
  key: ScriptStep,
  prompt: StepPrompt,
  onProgress: NonNullable<StageOptions["onProgress"]>,
): Promise<StepResult> {
  const spec = stepSpec(key);
  const cache = { type: "ephemeral" as const };
  // Sistema, contexto común y bloques ya listos con caché: el paso siguiente
  // reutiliza el prefijo del anterior.
  const content = [
    { type: "text" as const, text: prompt.shared, cache_control: cache },
    ...prompt.done.map((b, i) => ({
      type: "text" as const,
      text: `### BLOQUE: ${b.title}\n${b.body.trim()}`,
      ...(i === prompt.done.length - 1 && { cache_control: cache }),
    })),
    { type: "text" as const, text: prompt.task },
  ];
  const stream = client.beta.messages.stream({
    model: config.model,
    max_tokens: 64_000,
    system: [{ type: "text", text: prompt.system, cache_control: cache }],
    messages: [{ role: "user", content }],
    output_config: { effort: spec.effort },
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
  // Se pide un solo bloque; si llega sin la línea «### BLOQUE:», vale el texto entero.
  const blocks = parseBlocks(text);
  const body = (findBlock(blocks, spec.title) ?? blocks[0])?.body ?? text.trim();
  return {
    text,
    block: { title: spec.title, body },
    incomplete: final.stop_reason === "max_tokens" || !body.trim(),
    usage,
    model: final.model,
  };
}
