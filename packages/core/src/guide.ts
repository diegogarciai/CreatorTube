/**
 * Guía del guionista por secciones numeradas ("0. PRIORIDADES", "1. ROL"…).
 * Cada etapa del guion recibe solo las secciones que usa; la tabla por defecto
 * sale del documento de reglas v4.1 de Gartechs y cada canal puede cambiarla.
 */
export const GUIDE_STAGES = [
  "direction",
  "study",
  "script",
  "verification_extract",
  "verification_fix",
  "verification_mark",
  "publication",
  "podcast",
] as const;
export type GuideStage = (typeof GUIDE_STAGES)[number];

export type StageSections = Record<GuideStage, string[]>;

export const DEFAULT_STAGE_SECTIONS: StageSections = {
  direction: ["2"],
  study: ["0", "1", "2", "3", "4", "5", "7", "15"],
  script: ["0", "1", "2", "3", "6", "7", "8", "9", "10", "11", "12", "13", "15", "23"],
  verification_extract: ["10"],
  verification_fix: ["0", "2", "6", "7", "8", "9", "10", "13", "15"],
  verification_mark: ["0", "6", "9", "10", "12", "13"],
  publication: ["0", "1", "2", "3", "6", "7", "8", "9", "12", "13", "14", "15", "16", "23"],
  podcast: ["0", "1", "2", "6", "7", "9", "15", "22", "23"],
};

export interface GuideSection {
  key: string;
  title: string;
  body: string;
}

export interface ParsedGuide {
  /** Texto antes de la sección 0 (título, fuente, fecha). No va a ninguna etapa. */
  preamble: string;
  sections: GuideSection[];
}

const LETTERS = "A-ZÁÉÍÓÚÜÑ";
// "0. PRIORIDADES", "## 2. CANAL, PRESENTADOR Y AUDIENCIA", "**10. VERIFICACIÓN DE DATOS (BLOQUEANTE)**".
// El título va todo en mayúsculas: así no se confunde con listas numeradas
// ("1. Verdad. Ningún dato falso…") ni con subsecciones ("4.1 Lo esencial…").
const HEADING = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?(\\d{1,2})\\.\\s+([${LETTERS}0-9][${LETTERS}0-9 ,:;()«»"'/·—–-]*?)(?:\\*\\*)?\\s*$`,
);

export function parseGuide(text: string): ParsedGuide {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: GuideSection[] = [];
  const preamble: string[] = [];
  let current: { key: string; title: string; lines: string[] } | null = null;
  let last = -1;

  for (const line of lines) {
    const m = HEADING.exec(line);
    const n = m ? Number(m[1]) : NaN;
    // Solo cuenta como sección si el número sube: evita listas en mayúsculas.
    if (m && n > last && /[A-ZÁÉÍÓÚÑ]{3}/.test(m[2]!)) {
      if (current) sections.push(close(current));
      current = { key: String(n), title: m[2]!.trim(), lines: [] };
      last = n;
      continue;
    }
    (current ? current.lines : preamble).push(line);
  }
  if (current) sections.push(close(current));
  return { preamble: preamble.join("\n").trim(), sections };
}

function close(s: { key: string; title: string; lines: string[] }): GuideSection {
  return { key: s.key, title: s.title, body: s.lines.join("\n").trim() };
}

export interface GuideValidation {
  ok: boolean;
  /** Secciones que la tabla de etapas pide y el texto no trae. */
  missing: string[];
}

export function validateGuide(parsed: ParsedGuide, stages: StageSections): GuideValidation {
  const present = new Set(parsed.sections.map((s) => s.key));
  const wanted = new Set(Object.values(stages).flat());
  const missing = [...wanted].filter((k) => !present.has(k)).sort((a, b) => Number(a) - Number(b));
  return { ok: parsed.sections.length > 0 && missing.length === 0, missing };
}

/** Qué etapas reciben cada sección, para mostrarlo en la configuración. */
export function stagesBySection(stages: StageSections): Record<string, GuideStage[]> {
  const out: Record<string, GuideStage[]> = {};
  for (const stage of GUIDE_STAGES) {
    for (const key of stages[stage] ?? []) (out[key] ??= []).push(stage);
  }
  return out;
}

/**
 * Texto que recibe una etapa: las secciones en el orden de la guía, con su
 * título, tal cual se escribieron. Determinista para que la caché del prompt
 * sirva entre episodios.
 */
export function sectionsText(sections: readonly GuideSection[], keys: readonly string[]): string {
  const wanted = new Set(keys);
  return sections
    .filter((s) => wanted.has(s.key))
    .map((s) => `${s.key}. ${s.title}\n${s.body}`)
    .join("\n\n");
}
