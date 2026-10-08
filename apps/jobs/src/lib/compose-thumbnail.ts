import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";
import type { TextSide } from "@planificador/ai";

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

export interface ComposeOptions {
  lines: string[];
  accent: string;
  side: TextSide;
  colors: { text: string; accent: string };
  font?: opentype.Font;
}

const bare = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

/** El texto en trazos SVG: dos líneas de casi la mitad del ancho, del lado pedido. */
export function textOverlaySvg(opts: ComposeOptions): string {
  const font = opts.font ?? thumbnailFont();
  const margin = 64;
  const maxWidth = THUMB_WIDTH * 0.46;
  const lines = opts.lines
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2);
  const width = (text: string, size: number) => font.getAdvanceWidth(text, size);
  const widest = Math.max(1, ...lines.map((l) => width(l, 100)));
  const size = Math.max(64, Math.min(190, Math.floor((maxWidth / widest) * 100)));
  const lineHeight = size * 1.02;
  const top = (THUMB_HEIGHT - lineHeight * lines.length) / 2 + size * 0.8;
  const space = width(" ", size);
  let accentDone = false;

  const paths = lines.flatMap((line, i) => {
    const lineWidth = width(line, size);
    let x = opts.side === "left" ? margin : THUMB_WIDTH - margin - lineWidth;
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

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}">`,
    // Sombra suave y negra, solo para que se lea sobre la foto (manual v3.0).
    '<defs><filter id="s" x="-10%" y="-20%" width="120%" height="140%">',
    '<feDropShadow dx="0" dy="4" stdDeviation="12" flood-color="#000" flood-opacity="0.55"/>',
    "</filter></defs>",
    `<g filter="url(#s)">${paths.join("")}</g>`,
    "</svg>",
  ].join("");
}

/** La miniatura final en JPG de 1280 × 720 y menos de 2 MB. */
export async function composeThumbnail(base: Buffer, opts: ComposeOptions): Promise<Buffer> {
  const image = await sharp(base)
    .rotate()
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: "cover", position: "centre" })
    .composite([{ input: Buffer.from(textOverlaySvg(opts)), top: 0, left: 0 }])
    .png()
    .toBuffer();
  for (const quality of [88, 80, 72, 64]) {
    const out = await sharp(image).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length < MAX_BYTES) return out;
  }
  throw new Error("La miniatura no cabe en 2 MB");
}
