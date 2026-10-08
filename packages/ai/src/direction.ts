import { z } from "zod";

/**
 * Preguntas de dirección (documento "Reglas del guionista v4.1, preguntas de
 * dirección y etapas del guion"): antes de escribir, la IA lee el tema y le
 * hace al creador de 6 a 9 preguntas. El guion sale de sus respuestas.
 */
export const DIRECTION_TOPICS = [
  "enfoque",
  "postura",
  "mediciones",
  "alcance",
  "audiencia",
  "patrocinio",
  "especifica",
] as const;
export type DirectionTopic = (typeof DIRECTION_TOPICS)[number];

/** Lo que devuelve el modelo (salida estructurada). */
export const directionOutputSchema = z.object({
  reading: z.string(),
  questions: z.array(
    z.object({
      topic: z.enum(DIRECTION_TOPICS),
      question: z.string(),
      why: z.string(),
      multiple: z.boolean(),
      options: z.array(z.string()),
    }),
  ),
});
export type DirectionOutput = z.infer<typeof directionOutputSchema>;

// Alias (no interfaz) para que se pueda guardar como JSON en la base.
export type DirectionQuestion = {
  id: string;
  topic: DirectionTopic;
  question: string;
  why: string;
  multiple: boolean;
  options: string[];
};

// Alias (no interfaz) para que se pueda guardar como JSON en la base.
export type DirectionAnswer = {
  selected: string[];
  text: string;
};
export type DirectionAnswers = Record<string, DirectionAnswer>;

export const EPISODE_TYPE_LABELS = {
  product: "Producto o compra",
  explainer: "Explicativo",
  news: "Actualidad con análisis",
  opinion: "Opinión o debate",
} as const;

export interface DirectionInput {
  /** Sección 2 de la guía (canal, presentador y audiencia), tal cual. */
  guideSections: string;
  /** Nombre del presentador para el encabezado de la Dirección. */
  presenter: string;
  title: string;
  stance: string;
  stanceConfirmed: boolean;
  notes: string;
  pillar: string | null;
  targetMinutes: number;
  episodeType: keyof typeof EPISODE_TYPE_LABELS | null;
  ownMeasurements: string;
  sponsorship: "none" | "sponsor" | "affiliate" | null;
  published: { title: string; date: string | null }[];
  nextVideo: { title: string; date: string | null } | null;
}

const SYSTEM = `Eres un productor editorial. Antes de que se escriba el guion de un episodio de YouTube, lees el tema y le haces al presentador entre 6 y 9 preguntas. El guion sale de sus respuestas, no de suposiciones sacadas de un título.

Reglas de las preguntas:
1. Primero lee el tema: qué puede significar, qué ambigüedades tiene y qué caminos distintos podría tomar. Resúmelo en "reading" en 2 a 4 frases.
2. Entre 6 y 9 preguntas, todas de ESTE tema. Si una pregunta sirve para cualquier video, cámbiala.
3. La primera es el enfoque (topic "enfoque"): de 2 a 4 caminos concretos y distintos, con lo que cada uno le promete al espectador.
4. Siempre cubre, aterrizado al tema, una pregunta de cada uno de estos topics:
   - "postura": su postura, con 2 o 3 posturas posibles y opuestas, sin inclinarte por ninguna.
   - "mediciones": qué probó o midió él y con qué equipo; una de las opciones es exactamente «No hice pruebas propias».
   - "alcance": qué entra y qué se queda por fuera.
   - "audiencia": a quién le habla, si no es el espectador de siempre.
   - "patrocinio": si hay patrocinio o enlaces de afiliado; las opciones son exactamente «No», «Patrocinio» y «Afiliados».
5. Según el tema agrega (topic "especifica") lo que cambie el guion: qué comparar contra qué, qué modelos o versiones exactas, qué experiencia propia contar, qué error común desmontar, si conecta con un video ya publicado.
6. No supones hechos ni das datos: solo preguntas. No preguntes la duración ni lo que resuelve el guionista (ganchos, títulos, miniaturas, estructura).
7. Preguntas cortas, con «tú» y nunca «vos». De 2 a 5 opciones por pregunta, de máximo 12 palabras cada una. Las opciones son atajos: siempre puede escribir su respuesta.
8. Cada pregunta trae en "why" una línea de por qué: qué cambia en el guion según lo que responda. "multiple" dice si admite varias opciones a la vez.

Si la ficha de entrada ya trae un dato (tipo, postura confirmada, mediciones, patrocinio), no lo vuelvas a preguntar como si no existiera: ofrece confirmarlo o precisarlo.

Este es el canal, el presentador y su audiencia:

<canal>
{{SECTIONS}}
</canal>`;

export function buildDirectionPrompt(input: DirectionInput): { system: string; user: string } {
  const lines = [
    `Tema o título: ${input.title}`,
    `Postura anotada: ${input.stance || "ninguna"}${input.stance && input.stanceConfirmed ? " (confirmada)" : ""}`,
    `Notas del presentador: ${input.notes.trim() || "ninguna"}`,
    `Pilar: ${input.pillar ?? "sin pilar"}`,
    `Duración objetivo: ${input.targetMinutes} minutos`,
    "",
    "Tipos de episodio: Producto o compra; Explicativo; Actualidad con análisis; Opinión o debate.",
    "Ficha de entrada (lo que solo el presentador puede dar):",
    `- Tipo: ${input.episodeType ? EPISODE_TYPE_LABELS[input.episodeType] : "sin definir"}`,
    `- Mediciones propias: ${input.ownMeasurements.trim() || "sin datos"}`,
    `- Patrocinio o afiliados: ${sponsorshipLabel(input.sponsorship)}`,
    "",
    "Contexto del canal:",
    `- Próximo video programado: ${input.nextVideo ? dated(input.nextVideo) : "ninguno"}`,
    "- Videos publicados:",
    ...(input.published.length
      ? input.published.map((v) => `  - ${dated(v)}`)
      : ["  - (todavía no hay videos publicados)"]),
  ];
  return {
    system: SYSTEM.replace("{{SECTIONS}}", input.guideSections.trim()),
    user: lines.join("\n"),
  };
}

function sponsorshipLabel(s: DirectionInput["sponsorship"]) {
  return s === "none"
    ? "No"
    : s === "sponsor"
      ? "Patrocinio"
      : s === "affiliate"
        ? "Afiliados"
        : "sin confirmar";
}

function dated(v: { title: string; date: string | null }) {
  return v.date ? `${v.title} (${v.date})` : v.title;
}

const REQUIRED: DirectionTopic[] = ["postura", "mediciones", "alcance", "audiencia", "patrocinio"];
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Reglas que se pueden contar. Devuelve la lista de fallas (vacía si cumple). */
export function checkDirection(out: DirectionOutput): string[] {
  const problems: string[] = [];
  const qs = out.questions;
  if (qs.length < 6 || qs.length > 9)
    problems.push(`Debe haber de 6 a 9 preguntas; hay ${qs.length}.`);
  if (qs[0]?.topic !== "enfoque") problems.push("La primera pregunta debe ser el enfoque.");
  else if (qs[0].options.length < 2 || qs[0].options.length > 4)
    problems.push("El enfoque debe traer de 2 a 4 caminos.");
  for (const t of REQUIRED) {
    if (!qs.some((q) => q.topic === t)) problems.push(`Falta la pregunta de ${t}.`);
  }
  const mediciones = qs.find((q) => q.topic === "mediciones");
  if (mediciones && !mediciones.options.some((o) => norm(o) === "no hice pruebas propias"))
    problems.push("La pregunta de mediciones debe incluir la opción «No hice pruebas propias».");
  const patrocinio = qs.find((q) => q.topic === "patrocinio");
  if (patrocinio) {
    const opts = patrocinio.options.map(norm);
    for (const o of ["no", "patrocinio", "afiliados"])
      if (!opts.includes(o))
        problems.push(`La pregunta de patrocinio debe incluir la opción «${o}».`);
  }
  qs.forEach((q, i) => {
    if (q.options.length < 2 || q.options.length > 5)
      problems.push(`La pregunta ${i + 1} debe tener de 2 a 5 opciones.`);
    if (q.options.some((o) => words(o) > 12))
      problems.push(`La pregunta ${i + 1} tiene opciones de más de 12 palabras.`);
    if (/\bvos\b/i.test(q.question)) problems.push(`La pregunta ${i + 1} usa «vos»; usa «tú».`);
    if (!q.why.trim()) problems.push(`La pregunta ${i + 1} no dice por qué importa.`);
  });
  return problems;
}

export function toQuestions(out: DirectionOutput): DirectionQuestion[] {
  return out.questions.map((q, i) => ({
    id: `q${i + 1}`,
    topic: q.topic,
    question: q.question.trim(),
    why: q.why.trim(),
    multiple: q.multiple,
    options: q.options.map((o) => o.trim()).filter(Boolean),
  }));
}

export function answerText(a: DirectionAnswer | undefined): string {
  if (!a) return "";
  return [...a.selected, a.text.trim()].filter(Boolean).join("; ");
}

/**
 * Bloque que reciben todas las etapas del guion al final del mensaje, con el
 * encabezado del documento de reglas.
 */
export function directionBlock(
  presenter: string,
  questions: readonly DirectionQuestion[],
  answers: DirectionAnswers,
  extra: string,
): string {
  const head =
    `DIRECCIÓN DEL EPISODIO (${presenter} respondió estas preguntas antes de generar. ` +
    "Es la ficha de entrada de la sección 3 y manda sobre cualquier suposición tuya: el enfoque, " +
    "el alcance y los ejemplos salen de aquí. Si confirmó una postura, la postura está confirmada " +
    "y no se marca POSTURA SIN CONFIRMAR. Si dijo que no hizo pruebas, no hay medición propia. " +
    "Si dijo que no hay patrocinio ni afiliados, no los hay. No contradigas ni amplíes lo que dijo; " +
    "donde no respondió, decides tú).";
  const body = questions.map((q) => {
    const a = answerText(answers[q.id]);
    return `${q.question}\n${a || "sin respuesta: decide tú con las reglas de siempre"}`;
  });
  const more = extra.trim() ? `Algo más: ${extra.trim()}` : "Algo más: nada";
  return [head, ...body, more].join("\n\n");
}

/** Lo que las respuestas fijan en la ficha de entrada del episodio. */
export interface BriefFromAnswers {
  stance?: string;
  stanceConfirmed?: boolean;
  sponsorship?: "none" | "sponsor" | "affiliate";
  ownMeasurements?: string;
}

export function briefFromAnswers(
  questions: readonly DirectionQuestion[],
  answers: DirectionAnswers,
): BriefFromAnswers {
  const out: BriefFromAnswers = {};
  const by = (topic: DirectionTopic) => questions.find((q) => q.topic === topic);

  const postura = by("postura");
  const posturaText = postura ? answerText(answers[postura.id]) : "";
  if (posturaText) {
    out.stance = posturaText.slice(0, 500);
    out.stanceConfirmed = true;
  }

  const patrocinio = by("patrocinio");
  const sel = patrocinio ? (answers[patrocinio.id]?.selected ?? []).map(norm) : [];
  if (sel.includes("patrocinio")) out.sponsorship = "sponsor";
  else if (sel.includes("afiliados")) out.sponsorship = "affiliate";
  else if (sel.includes("no")) out.sponsorship = "none";

  const med = by("mediciones");
  const medAnswer = med ? answers[med.id] : undefined;
  if (medAnswer) {
    const none = medAnswer.selected.some((o) => norm(o) === "no hice pruebas propias");
    const text = answerText({
      selected: medAnswer.selected.filter((o) => norm(o) !== "no hice pruebas propias"),
      text: medAnswer.text,
    });
    if (text) out.ownMeasurements = text.slice(0, 5000);
    else if (none) out.ownMeasurements = "";
  }
  return out;
}
