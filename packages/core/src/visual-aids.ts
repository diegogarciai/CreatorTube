/**
 * Plan de ayudas visuales (reglas del guionista v4.1, sección 12): motion
 * graphics a pantalla completa (M, fichas 12.5) y las ayudas que no tapan la
 * pantalla (12.8): etiquetas de concepto (C) y listas (L). Aquí viven las
 * reglas que el código puede comprobar; el resto lo decide Claude y lo aprueba
 * el presentador.
 */

export const AID_KINDS = ["M", "C", "L"] as const;
export type AidKind = (typeof AID_KINDS)[number];

/** Piezas de marca para animar una M (paso 4). Ninguna se repite en un episodio (12.2). */
export const AID_PIECES = [
  "bars",
  "ring",
  "counter",
  "timeline",
  "dot_matrix",
  "curve",
  "before_after",
  "comparison",
  "network",
  "zoom",
] as const;
export type AidPiece = (typeof AID_PIECES)[number];

export const AID_STATUSES = ["proposed", "approved", "discarded"] as const;
export type AidStatus = (typeof AID_STATUSES)[number];

export type AidElement = {
  text: string;
  /** La cifra que se anima (M), tal como sale de su fila. */
  value?: string | null;
  unit?: string | null;
  /** Primeras palabras exactas donde empieza (L). */
  anchor?: string | null;
};

/** Los cuatro criterios de 12.1, de 1 a 5 (hace falta 15 de 20). */
export type AidScores = {
  simplifies: number;
  central: number;
  reusable: number;
  noRealImage: number;
};

export type VisualAid = {
  kind: AidKind;
  code: string;
  /** Primeras palabras exactas del párrafo donde entra. */
  anchor: string;
  /** M: la idea visual. */
  idea?: string | null;
  /** M: título en pantalla; C: el término; L: el título. */
  title: string;
  /** C: la definición. */
  definition?: string | null;
  elements: AidElement[];
  /** M: filas de la tabla de verificación de donde salen las cifras. */
  rows: number[];
  footer?: string | null;
  durationS?: number | null;
  piece?: AidPiece | null;
  scores?: AidScores | null;
  /** M: la más fuerte también va en vertical 1080 × 1920 (12.7). */
  vertical?: boolean;
};

/** Una fila de la tabla de verificación, lo justo para revisar las cifras. */
export type AidClaimRow = { idx: number; status: string };

export const MAX_MOTION = 6;
export const MIN_MOTION_SCORE = 15;
export const AID_FOOTER_SITE = "gartechs.com";

const words = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean);
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const hasNumber = (s: string | null | undefined) => /\d/.test(s ?? "");

export const scoreTotal = (s: AidScores | null | undefined) =>
  s ? s.simplifies + s.central + s.reusable + s.noRealImage : 0;

/** ¿La M lleva cifras en pantalla? */
export const aidHasNumbers = (aid: Pick<VisualAid, "title" | "elements">) =>
  hasNumber(aid.title) || aid.elements.some((e) => hasNumber(e.text) || hasNumber(e.value));

/** Las infracciones de texto de una ayuda (12.4, 12.5 y 12.8); vacío si cumple. */
export function validateAidText(aid: VisualAid): string[] {
  const out: string[] = [];
  if (!aid.anchor.trim()) out.push("Falta dónde entra (las primeras palabras del párrafo).");
  if (aid.kind === "M") {
    const t = words(aid.title).length;
    if (t < 1 || t > 6) out.push(`El título en pantalla va de 1 a 6 palabras (tiene ${t}).`);
    if (!aid.idea?.trim()) out.push("Falta la idea visual.");
    if (!aid.elements.length) out.push("Faltan los elementos que se animan.");
    for (const e of aid.elements) {
      const n = words(e.text).length;
      const min = e.value ? 1 : 2;
      if (n < min || n > 6) {
        out.push(`Cada elemento va de 2 a 6 palabras («${e.text.trim()}» tiene ${n}).`);
        break;
      }
    }
    const footer = aid.footer ?? "";
    if (!footer.toLowerCase().includes(AID_FOOTER_SITE))
      out.push(`El pie lleva ${AID_FOOTER_SITE}.`);
    if (aidHasNumbers(aid) && !(/\b(19|20)\d{2}\b/.test(footer) && words(footer).length >= 3))
      out.push("Con cifras, el pie lleva la fuente y la fecha.");
    if (!aid.durationS || aid.durationS < 2 || aid.durationS > 30)
      out.push("La duración va de 2 a 30 segundos.");
    if (aidHasNumbers(aid) && !aid.rows.length)
      out.push("Con cifras, la ficha dice de qué filas de verificación salen.");
  } else if (aid.kind === "C") {
    const t = words(aid.title).length;
    if (t < 1 || t > 5) out.push(`El término va de 1 a 5 palabras (tiene ${t}).`);
    const d = words(aid.definition).length;
    if (d < 1 || d > 14) out.push(`La definición va de 1 a 14 palabras (tiene ${d}).`);
  } else {
    const t = words(aid.title).length;
    if (t < 1 || t > 4) out.push(`El título de la lista va de 1 a 4 palabras (tiene ${t}).`);
    if (aid.elements.length < 3) out.push("Una lista lleva 3 elementos o más.");
    for (const e of aid.elements) {
      const n = words(e.text).length;
      if (n < 2 || n > 6) {
        out.push(`Cada elemento va de 2 a 6 palabras («${e.text.trim()}» tiene ${n}).`);
        break;
      }
    }
    if (aid.elements.some((e) => !e.anchor?.trim()))
      out.push("Cada elemento dice dónde empieza (sus primeras palabras).");
  }
  return out;
}

/** Las cifras de una M salen de filas Verificado o Con matiz (12.3). */
export function validateAidRows(aid: VisualAid, claims: readonly AidClaimRow[]): string[] {
  if (aid.kind !== "M") return [];
  const out: string[] = [];
  for (const r of aid.rows) {
    const row = claims.find((c) => c.idx === r);
    if (!row) out.push(`La fila #${r} no existe en la verificación.`);
    else if (row.status !== "verified" && row.status !== "nuanced")
      out.push(`La fila #${r} no está Verificada ni Con matiz.`);
  }
  return out;
}

/** Los párrafos del teleprompter (separados por líneas en blanco). */
export const scriptParagraphs = (script: string) =>
  script
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** El índice del párrafo donde está el ancla (−1 si no aparece). */
export function paragraphOf(paragraphs: readonly string[], anchor: string): number {
  const a = fold(anchor);
  if (!a) return -1;
  return paragraphs.findIndex((p) => fold(p).includes(a));
}

export type PlanCheck = {
  /** Las ayudas que pasan, en orden de guion, con su párrafo. */
  kept: (VisualAid & { paragraph: number })[];
  /** Las que se descartan y por qué. */
  dropped: { code: string; reasons: string[] }[];
};

/**
 * Revisa el plan completo con las reglas de la sección 12 y se queda con lo
 * que cumple: textos, cifras con fila, ancla en el guion, M con 15/20 o más,
 * a lo sumo 6 M y nunca en párrafos seguidos, sin repetir pieza, sin C ni L
 * en un párrafo con M, una C por término y una sola M vertical.
 */
export function checkPlan(
  aids: readonly VisualAid[],
  ctx: { script: string; claims: readonly AidClaimRow[] },
): PlanCheck {
  const paragraphs = scriptParagraphs(ctx.script);
  const dropped: PlanCheck["dropped"] = [];
  const located = aids.map((a) => ({ ...a, paragraph: paragraphOf(paragraphs, a.anchor) }));

  // Primero cada ayuda por sí sola.
  const valid = located.filter((a) => {
    const reasons = [...validateAidText(a), ...validateAidRows(a, ctx.claims)];
    if (a.paragraph < 0) reasons.push("Su ancla no aparece en el guion verificado.");
    if (a.kind === "M" && scoreTotal(a.scores) < MIN_MOTION_SCORE)
      reasons.push(`Suma ${scoreTotal(a.scores)}/20; una M necesita ${MIN_MOTION_SCORE}.`);
    if (reasons.length) dropped.push({ code: a.code, reasons });
    return !reasons.length;
  });

  // Las M: las de más puntaje primero, sin párrafos seguidos ni piezas repetidas.
  const motions: typeof valid = [];
  for (const m of valid
    .filter((a) => a.kind === "M")
    .sort((a, b) => scoreTotal(b.scores) - scoreTotal(a.scores))) {
    const reasons: string[] = [];
    if (motions.length >= MAX_MOTION) reasons.push(`Ya hay ${MAX_MOTION} motion graphics.`);
    if (motions.some((o) => Math.abs(o.paragraph - m.paragraph) <= 1))
      reasons.push("Otra M ya está en ese párrafo o en uno seguido.");
    if (m.piece && motions.some((o) => o.piece === m.piece))
      reasons.push("Esa pieza ya se usa en otra M del episodio.");
    if (reasons.length) dropped.push({ code: m.code, reasons });
    else motions.push(m);
  }
  // Una sola vertical: la de más puntaje que la pidió.
  let vertical = false;
  for (const m of motions) {
    if (m.vertical && !vertical) vertical = true;
    else m.vertical = false;
  }
  const mParagraphs = new Set(motions.map((m) => m.paragraph));

  // C y L: nunca en un párrafo con M; una C por término.
  const terms = new Set<string>();
  const others = valid
    .filter((a) => a.kind !== "M")
    .filter((a) => {
      const reasons: string[] = [];
      if (mParagraphs.has(a.paragraph)) reasons.push("Ese párrafo ya tiene una M.");
      const term = fold(a.title);
      if (a.kind === "C" && terms.has(term)) reasons.push("Ese término ya tiene su etiqueta.");
      if (a.kind === "C" && !reasons.length) terms.add(term);
      if (reasons.length) dropped.push({ code: a.code, reasons });
      return !reasons.length;
    });

  const kept = [...motions, ...others].sort(
    (a, b) => a.paragraph - b.paragraph || AID_KINDS.indexOf(a.kind) - AID_KINDS.indexOf(b.kind),
  );
  return { kept: renumber(kept), dropped };
}

/** Códigos M1, C1, L1… en orden de guion. */
function renumber<T extends VisualAid>(aids: T[]): T[] {
  const n: Record<AidKind, number> = { M: 0, C: 0, L: 0 };
  return aids.map((a) => ({ ...a, code: `${a.kind}${++n[a.kind]}` }));
}

const PIECE_LABEL: Record<AidPiece, string> = {
  bars: "barras",
  ring: "anillo",
  counter: "cifra que cuenta",
  timeline: "línea de tiempo",
  dot_matrix: "matriz de puntos",
  curve: "curva",
  before_after: "antes y después",
  comparison: "comparación",
  network: "red de conexiones",
  zoom: "zoom",
};
export const pieceLabel = (p: AidPiece) => PIECE_LABEL[p];

/** El plan como texto para el editor, en orden de guion. */
export function planToText(aids: readonly VisualAid[]): string {
  return aids
    .map((a) => {
      const head = `${a.code} · Entra en «${a.anchor.trim()}»`;
      if (a.kind === "M") {
        return [
          head,
          `  Título: ${a.title}`,
          ...(a.idea ? [`  Idea visual: ${a.idea}`] : []),
          `  Elementos: ${a.elements.map((e) => [e.value, e.unit, e.text].filter(Boolean).join(" ")).join(" · ")}`,
          ...(a.rows.length ? [`  Filas: ${a.rows.map((r) => `#${r}`).join(", ")}`] : []),
          ...(a.footer ? [`  Pie: ${a.footer}`] : []),
          ...(a.durationS ? [`  Duración: ${a.durationS} s`] : []),
          ...(a.piece ? [`  Pieza: ${pieceLabel(a.piece)}`] : []),
          ...(a.vertical ? ["  También en vertical 1080 × 1920"] : []),
        ].join("\n");
      }
      if (a.kind === "C") return `${head}\n  CONCEPTO ${a.title}: ${a.definition ?? ""}`;
      return [
        head,
        `  Lista: ${a.title}`,
        ...a.elements.map((e) => `  - ${e.text}${e.anchor ? ` (entra en «${e.anchor}»)` : ""}`),
      ].join("\n");
    })
    .join("\n\n");
}
