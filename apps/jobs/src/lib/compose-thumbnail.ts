import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";
import type { SubjectBox, TextSide } from "@planificador/ai";

/**
 * Composición de la miniatura: la imagen de Gemini (sin texto) a 1280 × 720 y,
 * encima, el texto de la marca convertido en trazos con la tipografía del kit.
 * Así la letra y los colores son siempre los del manual.
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

export type TextVertical = "top" | "middle" | "bottom";
export type TextPlacement = {
  side: TextSide;
  vertical: TextVertical;
  /** Escala del texto: 1, o menos si así no tapa la cara ni el producto. */
  scale?: number;
};

export interface ComposeOptions {
  lines: string[];
  accent: string;
  /** null o ausente: la app busca la zona con menos detalle. */
  side?: TextSide | null;
  vertical?: TextVertical | null;
  colors: { text: string; accent: string };
  font?: opentype.Font;
  /** Lo que el texto no debe tapar (cara, cuerpo, producto), si se ubicó. */
  avoid?: SubjectBox[];
}

const bare = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
const MARGIN_X = 64;
const MARGIN_Y = 48;

/** Tamaño de letra y del bloque de texto: casi la mitad del ancho. */
function layoutText(opts: Pick<ComposeOptions, "lines" | "font"> & { scale?: number }) {
  const font = opts.font ?? thumbnailFont();
  const lines = opts.lines
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2);
  const width = (text: string, size: number) => font.getAdvanceWidth(text, size);
  const widest = Math.max(1, ...lines.map((l) => width(l, 100)));
  const full = Math.max(64, Math.min(190, Math.floor(((THUMB_WIDTH * 0.46) / widest) * 100)));
  const size = Math.max(48, Math.floor(full * (opts.scale ?? 1)));
  const lineHeight = size * 1.02;
  return {
    font,
    lines,
    size,
    lineHeight,
    width,
    blockWidth: Math.max(...lines.map((l) => width(l, size)), 1),
    blockHeight: lineHeight * Math.max(lines.length, 1),
  };
}

/** Dónde empieza el bloque de texto (esquina superior izquierda) según la zona. */
function blockOrigin(placement: TextPlacement, blockWidth: number, blockHeight: number) {
  const x = placement.side === "left" ? MARGIN_X : THUMB_WIDTH - MARGIN_X - blockWidth;
  const y =
    placement.vertical === "top"
      ? MARGIN_Y
      : placement.vertical === "bottom"
        ? THUMB_HEIGHT - MARGIN_Y - blockHeight
        : (THUMB_HEIGHT - blockHeight) / 2;
  return { x, y };
}

const ZONE_SCALES = [1, 0.85, 0.72];

/**
 * La zona más libre para el texto (lado × altura) y, si en ninguna cabe entero
 * sin tapar algo, un tamaño algo menor. Mide la imagen ya recortada a
 * 1280 × 720, reducida y en gris, por celdas: una celda con bordes (la cara, el
 * producto) o muy clara cuenta como ocupada. Lo que la persona fijó (lado o
 * altura) se respeta y solo se busca en lo demás.
 */
export async function findTextZone(
  image: Buffer,
  measure: (scale: number) => { width: number; height: number },
  fixed: { side?: TextSide | null; vertical?: TextVertical | null } = {},
  avoid: SubjectBox[] = [],
): Promise<TextPlacement> {
  const W = 320;
  const H = 180;
  const k = W / THUMB_WIDTH;
  const { data } = await sharp(image)
    .resize(W, H, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[Math.min(y, H - 1) * W + Math.min(x, W - 1)]!;
  const CELL = 5;
  const sides: TextSide[] = fixed.side ? [fixed.side] : ["left", "right"];
  const verticals: TextVertical[] = fixed.vertical ? [fixed.vertical] : ["middle", "top", "bottom"];
  let best: { placement: TextPlacement; score: number } | null = null;
  for (const [si, scale] of ZONE_SCALES.entries()) {
    const block = measure(scale);
    for (const side of sides) {
      for (const vertical of verticals) {
        const o = blockOrigin({ side, vertical }, block.width, block.height);
        const x0 = Math.max(0, Math.floor(o.x * k));
        const y0 = Math.max(0, Math.floor(o.y * k));
        const x1 = Math.min(W, Math.ceil((o.x + block.width) * k));
        const y1 = Math.min(H, Math.ceil((o.y + block.height) * k));
        let cells = 0;
        let busy = 0;
        let detailSum = 0;
        for (let cy = y0; cy < y1; cy += CELL) {
          for (let cx = x0; cx < x1; cx += CELL) {
            let detail = 0;
            let light = 0;
            let n = 0;
            for (let y = cy; y < Math.min(cy + CELL, y1); y++) {
              for (let x = cx; x < Math.min(cx + CELL, x1); x++) {
                const v = at(x, y);
                detail += Math.abs(at(x + 1, y) - v) + Math.abs(at(x, y + 1) - v);
                light += v;
                n++;
              }
            }
            detail /= n;
            light /= n;
            cells++;
            detailSum += detail;
            if (detail > 12 || light > 110) busy++;
          }
        }
        // Cuánto del bloque cae sobre la cara, el cuerpo o el producto (con un
        // margen): pesa más que cualquier otra cosa, y la cara aún más.
        let covered = 0;
        for (const b of avoid) {
          const pad = 0.03;
          const bx0 = (b.x - pad) * THUMB_WIDTH;
          const by0 = (b.y - pad) * THUMB_HEIGHT;
          const bx1 = (b.x + b.w + pad) * THUMB_WIDTH;
          const by1 = (b.y + b.h + pad) * THUMB_HEIGHT;
          const ix = Math.max(0, Math.min(o.x + block.width, bx1) - Math.max(o.x, bx0));
          const iy = Math.max(0, Math.min(o.y + block.height, by1) - Math.max(o.y, by0));
          covered += ((ix * iy) / (block.width * block.height)) * (b.label === "face" ? 3 : 1);
        }
        // Lo que manda es cuánto del bloque tapa algo; después, el detalle
        // promedio. Achicar el texto o salir del centro cuesta un poco.
        const score =
          covered * 300 +
          (busy / Math.max(cells, 1)) * 100 +
          detailSum / Math.max(cells, 1) +
          si * 4 +
          (vertical === "middle" ? 0 : 1);
        if (!best || score < best.score) best = { placement: { side, vertical, scale }, score };
      }
    }
  }
  return best!.placement;
}

/** El texto en trazos SVG en la zona dada, con una sombra suave detrás para leerlo. */
export function textOverlaySvg(opts: ComposeOptions & TextPlacement): string {
  const { font, lines, size, lineHeight, width, blockWidth, blockHeight } = layoutText(opts);
  const origin = blockOrigin(opts, blockWidth, blockHeight);
  const top = origin.y + size * 0.8;
  const space = width(" ", size);
  let accentDone = false;

  const paths = lines.flatMap((line, i) => {
    const lineWidth = width(line, size);
    let x = opts.side === "left" ? MARGIN_X : THUMB_WIDTH - MARGIN_X - lineWidth;
    const y = top + i * lineHeight;
    return line.split(/\s+/).map((word) => {
      const isAccent = !accentDone && bare(word) !== "" && bare(word) === bare(opts.accent);
      if (isAccent) accentDone = true;
      // En la palabra en naranja, los signos (¿?¡!) quedan en blanco.
      const [, pre = "", core = word, post = ""] = isAccent
        ? (/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(word) ?? [])
        : [];
      const parts = isAccent
        ? [
            [pre, opts.colors.text],
            [core, opts.colors.accent],
            [post, opts.colors.text],
          ]
        : [[word, opts.colors.text]];
      const out = parts
        .filter(([text]) => text)
        .map(([text, fill]) => {
          const d = font.getPath(text!, x, y, size).toPathData(2);
          x += width(text!, size);
          return `<path d="${d}" fill="${fill}"/>`;
        })
        .join("");
      x += space;
      return out;
    });
  });

  const cx = origin.x + blockWidth / 2;
  const cy = origin.y + blockHeight / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}">`,
    "<defs>",
    // Sombra suave y negra, solo para que se lea sobre la foto (manual v3.0):
    // una mancha difusa detrás del bloque y otra pegada a las letras.
    '<radialGradient id="scrim"><stop offset="0" stop-color="#000" stop-opacity="0.55"/>',
    '<stop offset="0.6" stop-color="#000" stop-opacity="0.3"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>',
    '<filter id="s" x="-10%" y="-20%" width="120%" height="140%">',
    '<feDropShadow dx="0" dy="4" stdDeviation="12" flood-color="#000" flood-opacity="0.55"/>',
    "</filter></defs>",
    `<ellipse data-scrim="1" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(blockWidth * 0.8).toFixed(1)}" ry="${(blockHeight * 1.1).toFixed(1)}" fill="url(#scrim)"/>`,
    `<g filter="url(#s)">${paths.join("")}</g>`,
    "</svg>",
  ].join("");
}

/**
 * La miniatura final en JPG de 1280 × 720 y menos de 2 MB, con el texto en la
 * zona pedida o, si no se pidió, en la más libre.
 */
export async function composeThumbnail(
  base: Buffer,
  opts: ComposeOptions,
): Promise<{ jpg: Buffer; placement: TextPlacement }> {
  const photo = await sharp(base)
    .rotate()
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const placement: TextPlacement =
    opts.side && opts.vertical
      ? { side: opts.side, vertical: opts.vertical }
      : await findTextZone(
          photo,
          (scale) => {
            const l = layoutText({ ...opts, scale });
            return { width: l.blockWidth, height: l.blockHeight };
          },
          { side: opts.side, vertical: opts.vertical },
          opts.avoid,
        );
  const image = await sharp(photo)
    .composite([{ input: Buffer.from(textOverlaySvg({ ...opts, ...placement })), top: 0, left: 0 }])
    .png()
    .toBuffer();
  for (const quality of [88, 80, 72, 64]) {
    const jpg = await sharp(image).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpg.length < MAX_BYTES) return { jpg, placement };
  }
  throw new Error("La miniatura no cabe en 2 MB");
}
