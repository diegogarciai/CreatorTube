/**
 * Plan de ayudas visuales (reglas del guionista v4.1, sección 12): motion
 * graphics a pantalla completa (M, fichas 12.5) y las ayudas que no tapan la
 * pantalla (12.8): etiquetas de concepto (C) y listas (L). Aquí viven las
 * reglas que el código puede comprobar; el resto lo decide Claude y lo aprueba
 * el presentador.
 */

import { wordCount } from "./retention";

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
  "flow",
  "equation",
  "myth",
] as const;
export type AidPiece = (typeof AID_PIECES)[number];

/**
 * La biblioteca de íconos de las M, por grupo: cada elemento puede llevar el
 * que mejor lo representa (el objeto que entra, cambia de estado o se conecta).
 */
export const AID_ICON_GROUPS = {
  Personas: [
    "usuario",
    "persona",
    "grupo",
    "persona_laptop",
    "cabeza",
    "cerebro",
    "mano",
    "cara_feliz",
    "cara_triste",
    "rostro_escaneo",
    "huella",
    "ojo",
  ],
  Dispositivos: [
    "telefono",
    "telefono_moderno",
    "tablet",
    "laptop",
    "pantalla",
    "escritorio",
    "mini_pc",
    "reloj_inteligente",
    "audifonos",
    "teclado",
    "mouse",
    "control_juego",
    "televisor",
    "parlante",
    "camara",
    "camara_web",
    "impresora",
    "gafas_vr",
    "dron",
    "router",
    "antena",
    "microfono",
    "volumen",
  ],
  Componentes: [
    "chip",
    "memoria",
    "ssd",
    "disco_duro",
    "usb",
    "enchufe",
    "tarjeta_sd",
    "ventilador",
    "tarjeta_grafica",
    "placa_base",
    "bateria",
    "bateria_baja",
    "bateria_llena",
    "rayo",
    "termometro",
    "wifi",
    "senal",
    "servidor",
    "nube",
    "nube_subida",
  ],
  Software: [
    "ventana",
    "navegador",
    "terminal",
    "codigo",
    "carpeta",
    "documento",
    "archivo_zip",
    "descarga",
    "subida",
    "campana",
    "chat",
    "correo",
    "calendario",
    "imagen",
    "video",
    "musica",
    "cursor",
    "toque",
    "actualizar",
    "intercambio",
    "enlace",
    "compartir",
    "lista",
    "lapiz",
    "ia",
    "robot",
    "base_datos",
    "red",
    "qr",
    "engranaje",
    "lupa",
  ],
  Seguridad: [
    "candado",
    "candado_abierto",
    "escudo",
    "escudo_check",
    "llave",
    "contrasena",
    "virus",
    "ojo_tachado",
    "alerta",
  ],
  "Dinero y datos": [
    "dinero",
    "tarjeta",
    "billetera",
    "moneda",
    "carrito",
    "etiqueta_precio",
    "porcentaje",
    "grafica",
    "tendencia_baja",
    "velocimetro",
    "trofeo",
    "balanza",
    "embudo",
    "diana",
    "reloj",
    "reloj_arena",
  ],
  "Lugares y logística": [
    "casa",
    "edificio",
    "tienda",
    "fabrica",
    "camion",
    "paquete_envio",
    "avion",
    "pin",
    "mapa",
    "mundo",
  ],
  Conceptos: [
    "bombilla",
    "cohete",
    "fuego",
    "gota",
    "hoja",
    "sol",
    "luna",
    "rompecabezas",
    "herramienta",
    "bandera",
  ],
  Símbolos: [
    "check",
    "equis",
    "pregunta",
    "info",
    "mas",
    "menos",
    "flecha_sube",
    "flecha_baja",
    "flecha_derecha",
    "corazon",
    "estrella",
    "pulgar",
  ],
} as const;
export type AidIcon = (typeof AID_ICON_GROUPS)[keyof typeof AID_ICON_GROUPS][number];
export const AID_ICONS = Object.values(AID_ICON_GROUPS).flat() as AidIcon[];
export const isAidIcon = (s: string | null | undefined): s is AidIcon =>
  Boolean(s) && (AID_ICONS as string[]).includes(s!);

/** Los seis casos de 12.1 en que va una M. */
export const AID_CASES = [
  "comparison",
  "mechanism",
  "calculation",
  "anchor_figure",
  "myth",
  "timeline",
] as const;
export type AidCase = (typeof AID_CASES)[number];

/**
 * Lo que pasa en pantalla en un momento de la M (12.6: algo se mueve en cada
 * frase). Un momento con texto crea un elemento, que entra con su animación
 * (la barra crece, la cifra cuenta, el nodo se conecta); los demás actúan
 * sobre un elemento que ya está.
 */
export const BEAT_ACTIONS = ["enter", "highlight", "zoom", "travel", "strike", "change"] as const;
export type BeatAction = (typeof BEAT_ACTIONS)[number];

/** Qué acciones sabe hacer cada pieza. */
export const PIECE_ACTIONS: Record<AidPiece, readonly BeatAction[]> = {
  bars: ["enter", "highlight", "zoom", "change"],
  ring: ["enter", "highlight", "zoom", "change"],
  counter: ["enter", "highlight", "zoom", "change"],
  timeline: ["enter", "highlight", "zoom", "travel"],
  dot_matrix: ["enter", "highlight", "change"],
  curve: ["enter", "highlight", "zoom"],
  before_after: ["enter", "highlight", "strike", "change"],
  comparison: ["enter", "highlight", "zoom", "strike"],
  network: ["enter", "highlight", "zoom", "travel"],
  zoom: ["enter", "highlight", "zoom"],
  flow: ["enter", "highlight", "zoom", "travel"],
  equation: ["enter", "highlight", "zoom"],
  myth: ["enter", "highlight", "strike"],
};

/** Un momento del guion de animación de una M. */
export type AidBeat = {
  /** Las palabras exactas de la frase del segmento, en orden. */
  phrase: string;
  action: BeatAction;
  /** El elemento sobre el que actúa (índice en `elements`) si no crea uno. */
  target?: number | null;
  /** Si crea un elemento: su texto (2 a 6 palabras), cifra, unidad y fila. */
  text?: string | null;
  value?: string | null;
  unit?: string | null;
  row?: number | null;
  /** El ícono del elemento que crea, o el nuevo en un cambio de estado. */
  icon?: AidIcon | null;
};

/** ¿El momento crea un elemento? */
export const beatCreates = (b: Pick<AidBeat, "text">) => Boolean(b.text?.trim());

/** Los elementos que crean los momentos, en orden. */
export function elementsFromBeats(beats: readonly AidBeat[]): AidElement[] {
  return beats.filter(beatCreates).map((b) => ({
    text: b.text!.trim(),
    value: b.value?.trim() || null,
    unit: b.unit?.trim() || null,
    ...(isAidIcon(b.icon) ? { icon: b.icon } : {}),
  }));
}

/** Las filas de verificación de las cifras de los momentos, sin repetir. */
export const rowsFromBeats = (beats: readonly AidBeat[]) => [
  ...new Set(beats.flatMap((b) => (b.value?.trim() && b.row ? [b.row] : []))),
];

/** El elemento sobre el que actúa cada momento (el que crea, o su `target`). */
export function beatTargets(beats: readonly AidBeat[]): (number | null)[] {
  let created = 0;
  return beats.map((b) => (beatCreates(b) ? created++ : (b.target ?? null)));
}

/** Ritmo de lectura por defecto (palabras por minuto). */
export const DEFAULT_SPEECH_WPM = 150;
export const MOTION_MIN_SECONDS = 4;
export const MOTION_MAX_SECONDS = 40;

/** La base guarda duraciones de hasta 60 s (las de más de 40 ya llevan aviso). */
export const MOTION_STORED_MAX_SECONDS = 60;

/** Cuánto dura un texto dicho al ritmo del canal, en segundos enteros. */
export const speechSeconds = (text: string, wpm = DEFAULT_SPEECH_WPM) =>
  Math.max(Math.ceil((wordCount(text) / wpm) * 60), 1);

/** La duración de una M con guion de animación, lista para guardar. */
export const motionSeconds = (segment: string | null | undefined, wpm = DEFAULT_SPEECH_WPM) =>
  Math.min(speechSeconds(segment ?? "", wpm), MOTION_STORED_MAX_SECONDS);

/**
 * Cuándo empieza y cuánto dura cada momento, en segundos: cada frase se lleva
 * de la duración de la M la parte que le toca por sus palabras.
 */
export function beatTimeline(
  beats: readonly Pick<AidBeat, "phrase">[],
  durationS: number,
): { start: number; seconds: number }[] {
  const words = beats.map((b) => Math.max(wordCount(b.phrase), 1));
  const total = words.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return words.map((w) => {
    const start = (acc / total) * durationS;
    acc += w;
    return { start, seconds: (w / total) * durationS };
  });
}

export const AID_STATUSES = ["proposed", "approved", "discarded"] as const;
export type AidStatus = (typeof AID_STATUSES)[number];

export type AidElement = {
  text: string;
  /** La cifra que se anima (M), tal como sale de su fila. */
  value?: string | null;
  unit?: string | null;
  /** Primeras palabras exactas donde empieza (L). */
  anchor?: string | null;
  /** M: el ícono de la biblioteca que lo representa. */
  icon?: AidIcon | null;
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
  /** M: el texto exacto del guion que explica (su duración es la de ese texto dicho). */
  segment?: string | null;
  /** M: el caso de 12.1. */
  aidCase?: AidCase | null;
  /** M: el guion de animación, frase por frase. Vacío en los planes anteriores. */
  beats?: AidBeat[];
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
    if (aid.beats?.length) out.push(...validateBeats(aid));
    else if (!aid.durationS || aid.durationS < 2 || aid.durationS > 30)
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

/** El guion de animación de una M: frases en orden que cubren el segmento, y acciones posibles. */
function validateBeats(aid: VisualAid): string[] {
  const out: string[] = [];
  const beats = aid.beats ?? [];
  if (beats.length < 2 || beats.length > 8)
    out.push(`El guion de animación lleva de 2 a 8 momentos (tiene ${beats.length}).`);
  const segment = fold(aid.segment ?? "");
  if (!segment) out.push("Falta el segmento del guion que explica la M.");
  else {
    let from = 0;
    let inOrder = true;
    for (const b of beats) {
      const at = segment.indexOf(fold(b.phrase), from);
      if (!fold(b.phrase) || at < 0) {
        inOrder = false;
        break;
      }
      from = at + fold(b.phrase).length;
    }
    const covered = beats.reduce((a, b) => a + wordCount(b.phrase), 0);
    const total = wordCount(aid.segment ?? "");
    if (!inOrder) out.push("Cada momento copia su frase del segmento, tal cual y en orden.");
    else if (Math.abs(covered - total) > Math.max(2, total * 0.1))
      out.push(
        "Las frases de los momentos cubren el segmento completo: algo se mueve en cada frase.",
      );
  }
  if (beats.length && !beatCreates(beats[0]!))
    out.push("El primer momento hace entrar un elemento.");
  const allowed = aid.piece ? PIECE_ACTIONS[aid.piece] : BEAT_ACTIONS;
  let created = 0;
  for (const [i, b] of beats.entries()) {
    const n = i + 1;
    if (!allowed.includes(b.action)) {
      out.push(
        `Momento ${n}: la pieza ${aid.piece ? pieceLabel(aid.piece) : ""} no sabe «${b.action}».`,
      );
      continue;
    }
    if (beatCreates(b)) {
      created++;
      continue;
    }
    if (b.target == null || b.target < 0 || b.target >= created)
      out.push(`Momento ${n}: dice sobre qué elemento actúa (uno que ya entró).`);
    if (b.action === "change" && !b.value?.trim() && !isAidIcon(b.icon))
      out.push(`Momento ${n}: un cambio de estado lleva la cifra o el ícono nuevo.`);
  }
  const d = aid.durationS ?? 0;
  if (d < MOTION_MIN_SECONDS || d > MOTION_MAX_SECONDS)
    out.push(
      `Dicho, el segmento dura ${d} s; una M va de ${MOTION_MIN_SECONDS} a ${MOTION_MAX_SECONDS} s (acórtalo o alárgalo).`,
    );
  return out;
}

/** Las cifras de una M salen de filas Verificado o Con matiz (12.3). */
export function validateAidRows(aid: VisualAid, claims: readonly AidClaimRow[]): string[] {
  if (aid.kind !== "M") return [];
  const out: string[] = [];
  for (const [i, b] of (aid.beats ?? []).entries()) {
    if (b.value?.trim() && !b.row) out.push(`Momento ${i + 1}: su cifra no dice de qué fila sale.`);
  }
  for (const r of new Set([...aid.rows, ...rowsFromBeats(aid.beats ?? [])])) {
    const row = claims.find((c) => c.idx === r);
    if (!row) out.push(`La fila #${r} no existe en la verificación.`);
    else if (row.status !== "verified" && row.status !== "nuanced")
      out.push(`La fila #${r} no está Verificada ni Con matiz.`);
  }
  return out;
}

/** Una fila de `visual_aids`, lo justo para armar la ayuda. */
export type AidRow = {
  kind: string;
  code: string;
  anchor: string;
  idea: string | null;
  title: string;
  definition: string | null;
  elements: unknown;
  claim_rows: number[];
  footer: string | null;
  duration_s: number | null;
  piece: string | null;
  vertical: boolean;
  scores?: unknown;
  segment?: string | null;
  aid_case?: string | null;
  beats?: unknown;
};

/** La ayuda de una fila de la base (la web, el render y la aprobación la leen igual). */
export function aidFromRow(r: AidRow): VisualAid {
  return {
    kind: r.kind as AidKind,
    code: r.code,
    anchor: r.anchor,
    idea: r.idea,
    title: r.title,
    definition: r.definition,
    elements: (r.elements as AidElement[] | null) ?? [],
    rows: r.claim_rows,
    footer: r.footer,
    durationS: r.duration_s,
    piece: r.piece as AidPiece | null,
    scores: (r.scores as AidScores | null | undefined) ?? null,
    vertical: r.vertical,
    segment: r.segment ?? null,
    aidCase: (r.aid_case as AidCase | null | undefined) ?? null,
    beats: (r.beats as AidBeat[] | null | undefined) ?? [],
  };
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

export type DroppedAid = { code: string; kind?: AidKind; title?: string; reasons: string[] };

export type PlanCheck = {
  /**
   * Las ayudas que pasan, en orden de guion, con su párrafo. `issues` son los
   * textos fuera de límite (12.4): la ayuda queda, pero hay que corregirla
   * antes de aprobarla.
   */
  kept: (VisualAid & { paragraph: number; issues: string[] })[];
  /** Las que se descartan y por qué (con su tipo y título, para mostrarlas). */
  dropped: DroppedAid[];
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

  // Primero cada ayuda por sí sola. Lo de contenido (filas, ancla, puntaje)
  // la descarta; los textos fuera de límite solo la marcan para corregir.
  const valid = located
    .filter((a) => {
      const reasons = [...validateAidRows(a, ctx.claims)];
      if (a.paragraph < 0) reasons.push("Su ancla no aparece en el guion verificado.");
      if (a.kind === "M" && a.beats?.length && !fold(ctx.script).includes(fold(a.segment ?? "")))
        reasons.push("Su segmento no aparece tal cual en el guion verificado.");
      if (a.kind === "M" && scoreTotal(a.scores) < MIN_MOTION_SCORE)
        reasons.push(`Suma ${scoreTotal(a.scores)}/20; una M necesita ${MIN_MOTION_SCORE}.`);
      if (reasons.length) dropped.push({ code: a.code, kind: a.kind, title: a.title, reasons });
      return !reasons.length;
    })
    .map((a) => ({ ...a, issues: validateAidText(a) }));

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
    if (reasons.length) dropped.push({ code: m.code, kind: m.kind, title: m.title, reasons });
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
      if (reasons.length) dropped.push({ code: a.code, kind: a.kind, title: a.title, reasons });
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
  flow: "flujo de pasos",
  equation: "la cuenta",
  myth: "mito y realidad",
};
export const pieceLabel = (p: AidPiece) => PIECE_LABEL[p];

const ACTION_LABEL: Record<BeatAction, string> = {
  enter: "entra",
  highlight: "se resalta",
  zoom: "zoom a",
  travel: "un dato viaja a",
  strike: "se tacha",
  change: "cambia a",
};
export const actionLabel = (a: BeatAction) => ACTION_LABEL[a];

const CASE_LABEL: Record<AidCase, string> = {
  comparison: "Comparación",
  mechanism: "Mecanismo",
  calculation: "La cuenta",
  anchor_figure: "Dato ancla",
  myth: "Mito y realidad",
  timeline: "Línea de tiempo",
};
export const caseLabel = (c: AidCase) => CASE_LABEL[c];

/** Cada momento en una línea: tiempo, frase y qué pasa en pantalla. */
export function beatLines(aid: VisualAid): string[] {
  const beats = aid.beats ?? [];
  const times = beatTimeline(beats, aid.durationS ?? 0);
  const targets = beatTargets(beats);
  const elements = elementsFromBeats(beats);
  return beats.map((b, i) => {
    const el = elements[targets[i] ?? -1];
    const what = beatCreates(b)
      ? [b.value, b.unit, b.text].filter(Boolean).join(" ")
      : [el?.text, b.action === "change" ? [b.value, b.unit].filter(Boolean).join(" ") : ""]
          .filter(Boolean)
          .join(" → ");
    const row = b.value?.trim() && b.row ? ` (fila #${b.row})` : "";
    return `  ${i + 1}. ${times[i]!.start.toFixed(1)} s · «${b.phrase.trim()}» → ${actionLabel(b.action)}: ${what}${row}`;
  });
}

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
          ...(a.beats?.length ? ["  Guion de animación:", ...beatLines(a)] : []),
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
