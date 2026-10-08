import type Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { EPISODE_TYPE_LABELS } from "./direction";
import { isTransientAiError } from "./errors";
import { AiRefusalError, type AiConfig } from "./generate";
import type { GuideStage } from "@planificador/core";

/**
 * Guion en etapas (documento "Las 5 etapas del guion"): cada etapa recibe solo
 * sus secciones de la guía y el material de las anteriores, y entrega texto en
 * bloques que empiezan con "### BLOQUE: " y el título exacto.
 */
export const SCRIPT_STAGES = ["study", "script", "verification", "publication", "podcast"] as const;
export type ScriptStage = (typeof SCRIPT_STAGES)[number];

/** Etapas que la app genera (todas). */
export const IMPLEMENTED_STAGES: readonly ScriptStage[] = SCRIPT_STAGES;

/**
 * Cada etapa se genera por pasos: una llamada por bloque, en orden, y cada paso
 * recibe lo que ya quedó listo. Los motion graphics y los B-rolls van después
 * de verificar, y los reels en Publicación: así salen del guion verificado y
 * no se pagan dos veces.
 */
export const SCRIPT_STEPS = [
  "dossier",
  "cards",
  "outline",
  "teleprompter",
  "quality",
  "revision",
  "claims",
  "verify",
  "fix",
  "motion",
  "broll",
  "reels_final",
  "assets",
  "sheet",
  "assets_json",
  "podcast_script",
  "podcast_desc",
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
  /** Qué secciones de la guía recibe (tabla de etapas de la guía). */
  guide: GuideStage;
  /**
   * Pasos que no son un bloque de texto: extraer afirmaciones y los assets en
   * JSON (salida estructurada) y verificar con búsqueda. Los corre la tarea
   * con su lógica.
   */
  special?: true;
}

const step = (
  key: ScriptStep,
  stage: ScriptStage,
  title: string,
  what: string,
  {
    plain = false,
    effort = "medium" as StepSpec["effort"],
    guide = stage as GuideStage,
    special = undefined as true | undefined,
  } = {},
): StepSpec => ({ key, stage, title, plain, what, effort, guide, ...(special && { special }) });

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
  ],
  verification: [
    step(
      "claims",
      "verification",
      "AFIRMACIONES A VERIFICAR",
      "sección 10.1: toda afirmación verificable del guion, separando hechos, opiniones y ___DATO pendientes",
      { guide: "verification_extract", special: true },
    ),
    step(
      "verify",
      "verification",
      "TABLA DE VERIFICACIÓN",
      "sección 10.3: cada hecho contrastado en la web, con estado, naturaleza, fuente, cita y fecha",
      { guide: "verification_extract", special: true },
    ),
    step(
      "fix",
      "verification",
      "GUION — TELEPROMPTER VERIFICADO",
      "el teleprompter de arriba corregido con la tabla de verificación: cada Con matiz reescrito con su matiz, cada dato de Marca dicho atribuido, cada ___DATO completado con su valor verificado, y cada No verificable o Contradicho resuelto con la regla 10.4 (reescribir con lo confirmado, eliminar la línea o dejar ___DATO POR CONFIRMAR___). Si la tabla trae «Decisiones del presentador», esas mandan: aplica en cada fila la salida que eligió y, si da un valor, úsalo tal cual. Aplica también el control de sesgo 10.7. Sin avisos ni notas dentro del texto: el panel los muestra. Texto plano, sin ninguna marca",
      { plain: true, effort: "high", guide: "verification_fix" },
    ),
    step(
      "motion",
      "verification",
      "MOTION GRAPHICS",
      "una ficha 12.5 por cada párrafo del teleprompter verificado con información importante. Solo cifras de filas Verificado o Con matiz de la tabla de arriba, y cada ficha dice de qué fila sale cada número",
      { guide: "verification_mark" },
    ),
    step(
      "broll",
      "verification",
      "PLAN DE B-ROLLS",
      "sección 11, sobre el teleprompter verificado de arriba",
      { guide: "script" },
    ),
  ],
  publication: [
    step(
      "reels_final",
      "publication",
      "REELS R1, R2 Y R3",
      "sección 13: elige en el guion verificado de arriba los tres fragmentos con los ángulos de la 13.1 y las reglas de la 13.2, y entrega los tres reels en orden (R1, R2 y R3) con el contenido de la 13.4: título interno, origen, ubicación, guion, texto en pantalla, B-roll, caption, hashtags y, solo si es toma aparte, gancho alternativo. El GUION de cada reel inmerso se copia palabra por palabra del guion verificado; el B-roll, si usa motion graphic, la versión vertical del más fuerte de arriba",
      { plain: true },
    ),
    step(
      "assets",
      "publication",
      "ASSETS DE PUBLICACIÓN",
      "sección 14: 3 títulos; 3 miniaturas desde el concepto de la escaleta, cada una con texto, escena, expresión, protagonista, composición, ayuda visual, emoción, título y texto alternativo; descripción de YouTube con capítulos tomados del guion verificado; 8 etiquetas; comentario fijado; y las fuentes de la 10.8. Toda cifra sale de filas Verificado o Con matiz de la tabla de verificación de arriba",
      { effort: "high" },
    ),
    step(
      "sheet",
      "publication",
      "FICHA DEL EPISODIO",
      "sección 16, con lo que ya quedó listo arriba. El estado de verificación sale de la tabla y de las marcas ___DATO que quedan en el guion verificado",
    ),
    step(
      "assets_json",
      "publication",
      "ASSETS EN JSON",
      "los assets y la ficha de arriba en JSON: títulos, miniaturas, descripción, capítulos, etiquetas, comentario fijado, fuentes, postura, tipo, público, 6 a 8 keywords y pilar",
      { plain: true, effort: "low", special: true },
    ),
  ],
  podcast: [
    step(
      "podcast_script",
      "podcast",
      "GUION DEL PODCAST",
      "sección 22: el guion verificado de arriba adaptado para escucharse sin ver nada. Cada motion graphic se vuelve narración y no se agrega ningún dato que no esté en el guion verificado o en la tabla. Texto plano, con las marcas [CORTINILLA] y [PAUSA] de la 22.8 como única excepción",
      { plain: true, effort: "high" },
    ),
    step(
      "podcast_desc",
      "podcast",
      "DESCRIPCIÓN DEL PODCAST",
      "sección 22.9, sobre el guion del podcast de arriba: título, gancho, dos párrafos, «En este episodio:», «Fuentes:» con las de la tabla de verificación y los enlaces del contexto del canal. Texto plano",
      { plain: true },
    ),
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

/** Textos de los pasos ya listos de la corrida, por clave (de todas las etapas). */
export type StepBodies = Partial<Record<ScriptStep, string>>;

/** La Corrección se salta cuando el control de calidad no encontró nada. */
export function skipsStep(key: ScriptStep, bodies: StepBodies): boolean {
  return key === "revision" && qualityVerdict(bodies.quality ?? "") === "pass";
}

/** El teleprompter con el que sigue el trabajo: el corregido, si lo hay. */
export function finalTeleprompter(bodies: StepBodies): string {
  return bodies.revision?.trim() ? bodies.revision : (bodies.teleprompter ?? "");
}

const block = (key: ScriptStep, body: string | undefined): Block[] =>
  body?.trim() ? [{ title: stepSpec(key).title, body }] : [];

/**
 * Lo que recibe cada paso además del contexto común de su etapa:
 * - Estudio y Guion: los bloques anteriores de su etapa; desde la Corrección no
 *   hay más pasos en Guion, así que la tabla de calidad solo la ve ella.
 * - Verificación: el teleprompter final y, según el paso, la tabla de
 *   verificación o el guion verificado. Nunca el teleprompter sin verificar
 *   junto al verificado, para que no se mezclen.
 * - Publicación y Podcast: solo lo que cada paso usa, siempre del guion
 *   verificado; el teleprompter sin verificar no llega a ninguno.
 */
export function stepInputs(key: ScriptStep, bodies: StepBodies): Block[] {
  const spec = stepSpec(key);
  const blocks = (...keys: ScriptStep[]) => keys.flatMap((k) => block(k, bodies[k]));
  switch (key) {
    case "reels_final":
      return blocks("fix", "motion");
    case "assets":
      return blocks("outline", "verify", "fix");
    case "sheet":
      return blocks("outline", "quality", "verify", "fix", "reels_final", "motion");
    case "assets_json":
      return blocks("assets", "sheet");
    case "podcast_script":
      return blocks("verify", "fix");
    case "podcast_desc":
      return blocks("verify", "podcast_script");
  }
  if (spec.stage === "verification") {
    const tele = [
      { title: stepSpec("teleprompter").title, body: finalTeleprompter(bodies) },
    ].filter((b) => b.body.trim());
    switch (key) {
      case "claims":
        return tele;
      case "fix":
        return [...tele, ...block("verify", bodies.verify)];
      case "motion":
        return [...block("verify", bodies.verify), ...block("fix", bodies.fix)];
      case "broll":
        return block("fix", bodies.fix);
      default:
        return [];
    }
  }
  const steps = STAGE_STEPS[spec.stage]!;
  return steps.slice(0, steps.indexOf(spec)).flatMap((s) => block(s.key, bodies[s.key]));
}

/**
 * Los bloques que una etapa entrega a las siguientes, en orden: el
 * teleprompter es el final y la corrección no va aparte.
 */
export function stageBlocks(stage: ScriptStage, bodies: StepBodies): Block[] {
  return (STAGE_STEPS[stage] ?? []).flatMap((s): Block[] => {
    if (s.key === "revision" || s.key === "claims") return [];
    const body = s.key === "teleprompter" ? finalTeleprompter(bodies) : bodies[s.key];
    return body?.trim() ? [{ title: s.title, body }] : [];
  });
}

/** Las marcas ___DATO que quedan en un texto (vacío si no queda ninguna). */
export function pendingDatos(text: string): string[] {
  return [...text.matchAll(/___\s*DATO[^_]*___/gi)].map((m) => m[0]);
}

/** La frase de cada marca ___DATO, para mostrar qué falta confirmar y dónde. */
export function pendingDatoLines(text: string): string[] {
  return [...text.matchAll(/___\s*DATO[^_]*___/gi)].map((m) => {
    const at = m.index ?? 0;
    const before = text.slice(0, at);
    const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"));
    const after = text.slice(at + m[0].length);
    const ends = [after.indexOf(". "), after.indexOf("\n")].filter((i) => i >= 0);
    const end = ends.length ? Math.min(...ends) + 1 : after.length;
    const sentence = (before.slice(start + 1) + m[0] + after.slice(0, end)).trim();
    return sentence.length > 200 ? `…${sentence.slice(-200)}` : sentence;
  });
}

/** Los pasos que la app genera, en orden, desde el primero de Estudio. */
export const IMPLEMENTED_STEPS: readonly StepSpec[] = IMPLEMENTED_STAGES.flatMap(
  (stage) => STAGE_STEPS[stage] ?? [],
);

/**
 * Lo que tiene que estar listo para arrancar desde un paso: todo lo anterior,
 * salvo que el Podcast no espera a Publicación (sale del guion verificado).
 */
export function stepPrerequisites(key: ScriptStep): StepSpec[] {
  const spec = stepSpec(key);
  const before = IMPLEMENTED_STEPS.slice(0, IMPLEMENTED_STEPS.indexOf(spec));
  return spec.stage === "podcast" ? before.filter((s) => s.stage !== "publication") : [...before];
}

/**
 * Los pasos que corre una corrida que arranca en `from`: hasta el final de
 * Publicación. El Podcast solo corre si se pide (botón «Generar podcast»).
 */
export function runSteps(from: ScriptStep): StepSpec[] {
  const spec = stepSpec(from);
  const rest = IMPLEMENTED_STEPS.slice(IMPLEMENTED_STEPS.indexOf(spec));
  return spec.stage === "podcast" ? rest : rest.filter((s) => s.stage !== "podcast");
}

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
    /** Pilares activos del canal: Publicación elige uno. */
    pillars?: string[];
    podcastName?: string | null;
    /** Redes del canal (nombre y enlace), para las descripciones. */
    socials?: { name: string; url: string }[];
  } | null;
  previous: { stage: ScriptStage; blocks: Block[] }[];
}

const SYSTEM = `Te llama el panel de planificación del canal (modo panel). Cada llamada es un paso de una etapa y dice exactamente qué bloque entregar; esa instrucción manda sobre cualquier otra lista de entregables. No haces preguntas, no generas archivos (PDF, PNG, CSV) y no buscas en la web: entregas todo como texto, dentro de bloques que empiezan con una línea «### BLOQUE: » seguida del título exacto. El teleprompter, los reels y el podcast van en texto plano; el resto, en Markdown.

Aplica al pie de la letra estas instrucciones:

<instrucciones>
{{SECTIONS}}
</instrucciones>`;

const SCRIPT_EXTRA = `Como esta etapa no busca en la web, tiene dos reglas extra (la verificación con búsqueda llega en la etapa siguiente):
- Cada afirmación es concreta (sujeto, modelo, año, cifra). Sin cifra, se dice como opinión.
- «___DATO: …___» solo para lo que no puedes saber, como precios actuales o productos posteriores a tu fecha de corte: máximo 3, cada uno con una sola cosa precisa (modelo, país y moneda).`;

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
    // Lo que solo usan Publicación y Podcast; el resto de etapas no cambia.
    if (stage === "publication" || stage === "podcast") {
      const { pillars = [], podcastName, socials = [] } = ctx.channel;
      if (stage === "publication") {
        parts.push(
          `- Pilares del canal (el pilar del episodio es uno de estos, con el nombre exacto): ${
            pillars.length ? pillars.join(", ") : "el canal no tiene pilares"
          }`,
        );
      }
      if (podcastName) parts.push(`- Nombre del podcast: ${podcastName}`);
      parts.push(
        `- Redes del canal: ${
          socials.length ? socials.map((s) => `${s.name}: ${s.url}`).join(" · ") : "ninguna anotada"
        }`,
      );
    }
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
    done.length ? "Arriba está el material que ya quedó listo." : "",
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
