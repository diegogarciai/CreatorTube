import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";
import type { SubjectBox } from "@planificador/ai";
import {
  DURATION_BOX,
  FACE_GAP,
  SAFE_MARGIN,
  schemeLayout,
  TEXT_SIZE,
  THUMBNAIL_SCHEMES,
  type Rect,
  type SchemeId,
} from "@planificador/core";

/**
 * Composición de la miniatura (guía de miniaturas v1.0): la imagen de Gemini
 * (sin texto) a 1280 × 720 y, encima, el texto en la zona de su esquema,
 * convertido en trazos: Inter Black, tracking −4 %, interlineado 0,92, alto de
 * cuerpo de 120 a 150 px (la cifra de B hasta 300), blanco con una palabra
 * naranja y sombra suave solo para que se lea.
 */

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;
const MAX_BYTES = 2 * 1024 * 1024;
const FONT_FILE = "InterDisplay-Black.ttf";

let cachedFont: opentype.Font | null = null;

/** La fuente va con el motor (extensión additionalFiles de Trigger.dev). */
export function thumbnailFont(): opentype.Font {
  if (cachedFont) return cachedFont;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.THUMBNAIL_FONT_PATH,
    resolve(process.cwd(), "assets/fonts", FONT_FILE),
    resolve(here, "../../assets/fonts", FONT_FILE),
  ].filter((p): p is string => Boolean(p));
  const file = candidates.find((p) => existsSync(p));
  if (!file) throw new Error(`No se encontró la fuente ${FONT_FILE}`);
  const buf = readFileSync(file);
  cachedFont = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return cachedFont;
}

/** Una referencia lista para Gemini: orientada, de 1536 px como máximo y en JPG. */
export async function prepareReference(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

const TRACKING = -0.04;
type Colors = { text: string; accent: string };
const LEADING = 0.92;

export interface ComposeOptions {
  scheme: SchemeId;
  /** Texto del otro lado (solo A y C). */
  mirror?: boolean;
  text: string;
  accent: string;
  colors: Colors;
  /** «Sin texto»: solo la foto con el viñeteado, sin letras ni degradado. */
  noText?: boolean;
  /** La cara y el producto que ubicó Claude (fracciones), para la separación. */
  avoid?: SubjectBox[];
  font?: opentype.Font;
}

export interface ComposeResult {
  jpg: Buffer;
  /** Las líneas en que quedó partido el texto. */
  lines: string[];
  /** Dónde quedó el texto y a qué tamaño (alto de cuerpo). */
  textBox: Rect;
  size: number;
  /** Lo que no se pudo cumplir del manual (para la tarjeta y la calificación). */
  warnings: string[];
}

const bare = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

type Glyph = { glyph: opentype.Glyph; x: number; y: number; size: number; fill: string };

/** Color de cada carácter: la palabra naranja (sin ¿?¡! alrededor) en el acento. */
function charFills(text: string, isAccent: (word: string) => boolean, colors: Colors) {
  const fills: string[] = [];
  for (const m of text.matchAll(/(\S+)|(\s+)/g)) {
    const word = m[0];
    if (m[2] || !isAccent(word)) {
      for (const _ of word) fills.push(colors.text);
      continue;
    }
    const [, pre = "", core = word, post = ""] =
      /^([^\p{L}\p{N}$€%×]*)(.*?)([^\p{L}\p{N}%×]*)$/u.exec(word) ?? [];
    for (const _ of pre) fills.push(colors.text);
    for (const _ of core) fills.push(colors.accent);
    for (const _ of post) fills.push(colors.text);
  }
  return fills;
}

/** Ancho de una línea con kerning y el tracking del manual. */
function measure(font: opentype.Font, text: string, size: number) {
  const chars = [...text];
  const scale = size / font.unitsPerEm;
  let w = 0;
  chars.forEach((ch, i) => {
    const g = font.charToGlyph(ch);
    w += (g.advanceWidth ?? 0) * scale;
    const next = chars[i + 1];
    if (next) w += font.getKerningValue(g, font.charToGlyph(next)) * scale + TRACKING * size;
  });
  return w;
}

/**
 * Las líneas armadas desde el origen (primera línea base en y = 0), con la
 * caja de la tinta: lo que de verdad ocupan las letras, con sus descendentes.
 */
function shape(
  font: opentype.Font,
  lines: string[],
  sizes: number[],
  align: "left" | "center",
  fills: string[][],
) {
  const glyphs: Glyph[] = [];
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  let baseline = 0;
  lines.forEach((line, li) => {
    const size = sizes[li]!;
    if (li > 0) baseline += size * LEADING;
    const scale = size / font.unitsPerEm;
    const chars = [...line];
    let x = align === "center" ? -measure(font, line, size) / 2 : 0;
    chars.forEach((ch, i) => {
      const glyph = font.charToGlyph(ch);
      const bb = glyph.getPath(x, baseline, size).getBoundingBox();
      if (bb.x2 > bb.x1) {
        x1 = Math.min(x1, bb.x1);
        y1 = Math.min(y1, bb.y1);
        x2 = Math.max(x2, bb.x2);
        y2 = Math.max(y2, bb.y2);
        glyphs.push({ glyph, x, y: baseline, size, fill: fills[li]![i]! });
      }
      x += (glyph.advanceWidth ?? 0) * scale;
      const next = chars[i + 1];
      if (next) x += font.getKerningValue(glyph, font.charToGlyph(next)) * scale + TRACKING * size;
    });
  });
  return { glyphs, ink: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } };
}

/** Corta el texto en líneas según el esquema (D: una; B: la cifra y lo demás). */
function breakLines(scheme: SchemeId, text: string, widest: (lines: string[]) => number): string[] {
  const words = text.trim().split(/\s+/);
  if (scheme === "D" || words.length < 2) return [words.join(" ")];
  if (scheme === "B") {
    const m = /^([$€]?\d+(?:%|×|x)?(?:\s(?:h|GB|TB|W|Hz|K|mAh|min))?)\s+(.*)$/u.exec(text.trim());
    return m ? [m[1]!, m[2]!] : [words.join(" ")];
  }
  // Dos líneas: el corte que deja la línea más ancha más corta.
  let best: string[] = [words.join(" ")];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const w = widest(lines);
    if (w < bestW) {
      bestW = w;
      best = lines;
    }
  }
  return best;
}

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Distancia entre dos rectángulos (0 si se tocan). */
function gap(a: Rect, b: Rect) {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * Coloca el texto del esquema: el tamaño más grande del rango que cabe en su
 * zona y deja 40 px a la cara. Devuelve los trazos, la caja de la tinta y los
 * avisos de lo que no se pudo cumplir.
 */
export function schemeTextLayout(opts: Omit<ComposeOptions, "colors"> & { colors?: Colors }) {
  const font = opts.font ?? thumbnailFont();
  const layout = schemeLayout(opts.scheme, opts.mirror);
  const zone = layout.zone;
  const colors = opts.colors ?? { text: "#FFFFFF", accent: "#FF7A29" };
  const boxes = (label: SubjectBox["label"]) =>
    (opts.avoid ?? [])
      .filter((b) => b.label === label)
      .map((b) => ({
        x: b.x * THUMB_WIDTH,
        y: b.y * THUMB_HEIGHT,
        w: b.w * THUMB_WIDTH,
        h: b.h * THUMB_HEIGHT,
      }));
  const faces = boxes("face");
  const products = boxes("product");
  const warnings: string[] = [];

  const lines = breakLines(opts.scheme, opts.text, (ls) =>
    Math.max(...ls.map((l) => measure(font, l, TEXT_SIZE.max))),
  );
  // Una sola palabra naranja: la primera que coincide.
  let accentDone = false;
  const isAccent = (word: string) => {
    const hit = !accentDone && bare(word) !== "" && bare(word) === bare(opts.accent);
    if (hit) accentDone = true;
    return hit;
  };
  const fills = lines.map((l) => charFills(l, isAccent, colors));

  /** El bloque a esos tamaños, puesto en la zona según el esquema. */
  const place = (sizes: number[]) => {
    const s = shape(font, lines, sizes, layout.align, fills);
    const dx =
      layout.align === "center" ? zone.x + zone.w / 2 - (s.ink.x + s.ink.w / 2) : zone.x - s.ink.x;
    const dy =
      layout.anchor === "top"
        ? zone.y - s.ink.y
        : layout.anchor === "bottom"
          ? zone.y + zone.h - (s.ink.y + s.ink.h)
          : zone.y + (zone.h - s.ink.h) / 2 - s.ink.y;
    const box = { x: s.ink.x + dx, y: s.ink.y + dy, w: s.ink.w, h: s.ink.h };
    return { sizes, glyphs: s.glyphs, dx, dy, box };
  };
  const fits = (p: ReturnType<typeof place>) => p.box.w <= zone.w && p.box.h <= zone.h;

  // Tamaños de mayor a menor (B: la cifra de 300 a 150 y las palabras de 150 a 120).
  const tries: number[][] = [];
  if (opts.scheme === "B" && lines.length === 2) {
    for (let fig = TEXT_SIZE.figureMax; fig >= TEXT_SIZE.max; fig -= 10)
      for (let size = TEXT_SIZE.max; size >= TEXT_SIZE.min; size -= 5) tries.push([fig, size]);
  } else {
    for (let size = TEXT_SIZE.max; size >= TEXT_SIZE.min; size -= 5)
      tries.push(lines.map(() => size));
  }
  // Si no cabe todo, el producto manda sobre la persona: primero el tamaño
  // más grande que no tapa el producto y deja 40 px a la cara; si no hay, uno
  // que no tapa el producto; y si tampoco, el más pequeño, con avisos.
  const productFree = (p: ReturnType<typeof place>) => products.every((b) => !intersects(p.box, b));
  const faceFree = (p: ReturnType<typeof place>) => faces.every((f) => gap(p.box, f) >= FACE_GAP);
  const fitting = tries.map(place).filter(fits);
  let chosen: ReturnType<typeof place> | null =
    fitting.find((p) => productFree(p) && faceFree(p)) ?? null;
  if (!chosen && fitting.length) {
    // El más pequeño que no tapa el producto: así queda lo más lejos posible de la cara.
    chosen = [...fitting].reverse().find(productFree) ?? fitting[fitting.length - 1]!;
    if (!productFree(chosen)) warnings.push("El texto tapa parte del producto.");
    if (!faceFree(chosen)) warnings.push(`El texto queda a menos de ${FACE_GAP} px de la cara.`);
  }
  if (!chosen) {
    // Ni al tamaño mínimo cabe: se reduce lo justo para entrar en la zona.
    const base = place(tries[tries.length - 1]!);
    const k = Math.min(zone.w / base.box.w, zone.h / base.box.h, 1) * 0.995;
    chosen = place(base.sizes.map((c) => c * k));
    warnings.push(`El texto no cabe a ${TEXT_SIZE.min} px de cuerpo y se redujo.`);
    if (!productFree(chosen)) warnings.push("El texto tapa parte del producto.");
    if (!faceFree(chosen)) warnings.push(`El texto queda a menos de ${FACE_GAP} px de la cara.`);
  }
  const { box, dx, dy } = chosen;
  if (intersects(box, DURATION_BOX)) warnings.push("El texto toca la esquina de la duración.");
  if (
    box.x < SAFE_MARGIN ||
    box.y < SAFE_MARGIN ||
    box.x + box.w > THUMB_WIDTH - SAFE_MARGIN ||
    box.y + box.h > THUMB_HEIGHT - SAFE_MARGIN
  )
    warnings.push(`El texto se sale del margen de ${SAFE_MARGIN} px.`);

  const paths = chosen.glyphs.map((g) => {
    const d = g.glyph.getPath(g.x + dx, g.y + dy, g.size).toPathData(2);
    return `<path d="${d}" fill="${g.fill}"/>`;
  });
  return { lines, paths, box, size: Math.round(Math.max(...chosen.sizes)), warnings };
}

/** Degradado negro para E (desde abajo a la izquierda) y F (desde arriba a la izquierda). */
function gradientSvg(scheme: SchemeId) {
  const g = THUMBNAIL_SCHEMES[scheme].gradient;
  if (g === "none") return "";
  const cy = g === "bottom-left" ? "100%" : "0%";
  return [
    `<radialGradient id="tg" cx="0%" cy="${cy}" r="85%" gradientUnits="objectBoundingBox">`,
    '<stop offset="0" stop-color="#000" stop-opacity="0.85"/>',
    '<stop offset="0.55" stop-color="#000" stop-opacity="0.5"/>',
    '<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>',
  ].join("");
}

/** El SVG que va encima de la foto: viñeteado, degradado del esquema y texto. */
export function overlaySvg(paths: string[], scheme: SchemeId, opts: { gradient?: boolean } = {}) {
  // Sin texto no hace falta el degradado de E y F.
  const gradient = opts.gradient === false ? "" : gradientSvg(scheme);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">',
    "<defs>",
    // Viñeteado a negro (prompt base de la guía).
    '<radialGradient id="vig" cx="50%" cy="50%" r="75%">',
    '<stop offset="0.6" stop-color="#000" stop-opacity="0"/>',
    '<stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient>',
    gradient,
    // Sombra negra suave, solo para que se lea.
    '<filter id="s" x="-10%" y="-20%" width="120%" height="140%">',
    '<feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#000" flood-opacity="0.5"/>',
    "</filter></defs>",
    '<rect width="1280" height="720" fill="url(#vig)"/>',
    gradient ? '<rect data-gradient="1" width="1280" height="720" fill="url(#tg)"/>' : "",
    `<g filter="url(#s)">${paths.join("")}</g>`,
    "</svg>",
  ].join("");
}

/** La miniatura final en JPG de 1280 × 720 y menos de 2 MB, con el texto de su esquema. */
export async function composeScheme(base: Buffer, opts: ComposeOptions): Promise<ComposeResult> {
  const photo = await sharp(base)
    .rotate()
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const t = opts.noText
    ? {
        lines: [] as string[],
        paths: [] as string[],
        box: { x: 0, y: 0, w: 0, h: 0 },
        size: 0,
        warnings: [] as string[],
      }
    : schemeTextLayout(opts);
  const overlay = overlaySvg(t.paths, opts.scheme, { gradient: !opts.noText });
  const image = await sharp(photo)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toBuffer();
  for (const quality of [88, 80, 72, 64]) {
    const jpg = await sharp(image).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpg.length < MAX_BYTES)
      return { jpg, lines: t.lines, textBox: t.box, size: t.size, warnings: t.warnings };
  }
  throw new Error("La miniatura no cabe en 2 MB");
}

/** La miniatura reducida a 168 × 94 para la prueba de móvil. */
export async function mobilePreview(jpg: Buffer): Promise<Buffer> {
  return sharp(jpg).resize(168, 94).jpeg({ quality: 90 }).toBuffer();
}
