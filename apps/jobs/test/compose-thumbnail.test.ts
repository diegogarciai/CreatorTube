import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  TEXT_SIZE,
  DURATION_BOX,
  FACE_GAP,
  SAFE_MARGIN,
  SCHEME_IDS,
  schemeLayout,
  type Rect,
} from "@planificador/core";
import {
  composeScheme,
  mobilePreview,
  overlaySvg,
  prepareReference,
  schemeTextLayout,
  THUMB_HEIGHT,
  THUMB_WIDTH,
} from "../src/lib/compose-thumbnail";

const colors = { text: "#FFFFFF", accent: "#FF7A29" };

/** Un texto válido de cada esquema (los ejemplos de la guía). */
const SAMPLE = {
  A: { text: "¿Vale la pena?", accent: "pena" },
  B: { text: "40% más barato", accent: "40%" },
  C: { text: "Sí lo compro", accent: "compro" },
  D: { text: "¿Cuál gana?", accent: "gana" },
  E: { text: "Nadie lo nota", accent: "nota" },
  F: { text: "Un mes después", accent: "mes" },
} as const;

const inside = (a: Rect, b: Rect) =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.w <= b.x + b.w + 0.5 &&
  a.y + a.h <= b.y + b.h + 0.5;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Dónde quedan los píxeles naranjas: caja que los encierra y cuántos hay. */
async function orangeBox(jpg: Buffer) {
  const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (r > 200 && g > 90 && g < 160 && b < 80) {
        n++;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { n, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

const gray = () =>
  sharp({ create: { width: 1280, height: 720, channels: 3, background: "#6b6b6b" } })
    .png()
    .toBuffer();

describe("texto por esquema", () => {
  it.each(SCHEME_IDS)(
    "%s: dentro de su zona, del margen, lejos de la duración y a 120–150 px",
    (scheme) => {
      const t = schemeTextLayout({ scheme, ...SAMPLE[scheme] });
      expect(t.warnings).toEqual([]);
      expect(inside(t.box, schemeLayout(scheme).zone)).toBe(true);
      const safe = {
        x: SAFE_MARGIN,
        y: SAFE_MARGIN,
        w: THUMB_WIDTH - 2 * SAFE_MARGIN,
        h: THUMB_HEIGHT - 2 * SAFE_MARGIN,
      };
      expect(inside(t.box, safe)).toBe(true);
      expect(overlaps(t.box, DURATION_BOX)).toBe(false);
      expect(t.size).toBeGreaterThanOrEqual(TEXT_SIZE.min);
      expect(t.size).toBeLessThanOrEqual(scheme === "B" ? TEXT_SIZE.figureMax : TEXT_SIZE.max);
      expect(t.lines.length).toBeLessThanOrEqual(2);
    },
  );

  it("cada esquema pone el texto donde manda la guía", () => {
    const box = (scheme: (typeof SCHEME_IDS)[number], mirror = false) =>
      schemeTextLayout({ scheme, mirror, ...SAMPLE[scheme] }).box;
    // A: mitad izquierda; en espejo, mitad derecha.
    expect(box("A").x + box("A").w).toBeLessThanOrEqual(THUMB_WIDTH / 2);
    expect(box("A", true).x).toBeGreaterThanOrEqual(THUMB_WIDTH / 2);
    // C: 40 % derecho; en espejo, 40 % izquierdo.
    expect(box("C").x).toBeGreaterThanOrEqual(THUMB_WIDTH * 0.6);
    expect(box("C", true).x + box("C", true).w).toBeLessThanOrEqual(THUMB_WIDTH * 0.4);
    // B, E y F no se invierten.
    expect(box("B", true)).toEqual(box("B"));
    // D: una línea centrada arriba.
    const d = schemeTextLayout({ scheme: "D", ...SAMPLE.D });
    expect(d.lines).toHaveLength(1);
    expect(Math.abs(d.box.x + d.box.w / 2 - THUMB_WIDTH / 2)).toBeLessThan(1);
    expect(d.box.y).toBe(SAFE_MARGIN);
    // E abajo a la izquierda; F arriba a la izquierda.
    expect(box("E").y + box("E").h).toBeCloseTo(THUMB_HEIGHT - SAFE_MARGIN, 0);
    expect(box("E").x).toBe(SAFE_MARGIN);
    expect(box("F").y).toBe(SAFE_MARGIN);
    expect(box("F").x).toBe(SAFE_MARGIN);
  });

  it("B: la cifra grande arriba, en naranja, y las palabras debajo en blanco", () => {
    const t = schemeTextLayout({ scheme: "B", ...SAMPLE.B, colors });
    expect(t.lines).toEqual(["40%", "más barato"]);
    expect(t.size).toBeGreaterThan(TEXT_SIZE.max);
    // Un trazo por letra: «40%» en naranja y «más barato» en blanco.
    const fills = t.paths.map((p) => /fill="([^"]+)"/.exec(p)![1]);
    expect(fills).toEqual([...Array(3).fill("#FF7A29"), ...Array(9).fill("#FFFFFF")]);
  });

  it("una sola palabra en naranja y sus signos en blanco", () => {
    const t = schemeTextLayout({ scheme: "A", text: "¿Vale la pena?", accent: "pena", colors });
    const svg = t.paths.join("");
    // «pena» son 4 letras naranjas; «¿Vale la» y «?» (8) van en blanco.
    expect(svg.match(/fill="#FF7A29"/g)).toHaveLength(4);
    expect(svg.match(/fill="#FFFFFF"/g)).toHaveLength(8);
  });

  it("con la cara cerca, achica el texto para dejar 40 px", () => {
    const free = schemeTextLayout({ scheme: "A", ...SAMPLE.A });
    // Una cara que empieza 20 px después del texto a tamaño máximo.
    const right = free.box.x + free.box.w + 20;
    const face = {
      label: "face" as const,
      x: right / THUMB_WIDTH,
      y: 0.2,
      w: 0.3,
      h: 0.6,
    };
    const t = schemeTextLayout({ scheme: "A", ...SAMPLE.A, avoid: [face] });
    expect(t.warnings).toEqual([]);
    expect(t.size).toBeLessThan(free.size);
    expect(right - (t.box.x + t.box.w)).toBeGreaterThanOrEqual(FACE_GAP);
  });

  it("si ni al mínimo deja 40 px a la cara, lo avisa", () => {
    // La cara encima de toda la zona del texto.
    const face = { label: "face" as const, x: 0, y: 0, w: 0.6, h: 1 };
    const t = schemeTextLayout({ scheme: "A", ...SAMPLE.A, avoid: [face] });
    expect(t.size).toBe(TEXT_SIZE.min);
    expect(t.warnings).toEqual([`El texto queda a menos de ${FACE_GAP} px de la cara.`]);
  });

  it("achica el texto para no tapar el producto", () => {
    const free = schemeTextLayout({ scheme: "A", ...SAMPLE.A });
    // Un producto que se mete 10 px en el texto a tamaño máximo.
    const right = free.box.x + free.box.w - 10;
    const product = { label: "product" as const, x: right / THUMB_WIDTH, y: 0, w: 0.3, h: 1 };
    const t = schemeTextLayout({ scheme: "A", ...SAMPLE.A, avoid: [product] });
    expect(t.warnings).toEqual([]);
    expect(t.size).toBeLessThan(free.size);
    expect(t.box.x + t.box.w).toBeLessThanOrEqual(right);
  });

  it("si no cabe todo, el producto manda sobre la cara", () => {
    const free = schemeTextLayout({ scheme: "A", ...SAMPLE.A });
    const right = free.box.x + free.box.w;
    // El producto empieza justo después del texto al mínimo y la cara está pegada a él.
    const min = schemeTextLayout({
      scheme: "A",
      ...SAMPLE.A,
      avoid: [{ label: "face" as const, x: 0, y: 0, w: 0.6, h: 1 }],
    });
    const productX = (min.box.x + min.box.w + 5) / THUMB_WIDTH;
    const product = { label: "product" as const, x: productX, y: 0, w: 0.2, h: 1 };
    const face = { label: "face" as const, x: 0, y: 0.1, w: right / THUMB_WIDTH, h: 0.2 };
    const t = schemeTextLayout({ scheme: "A", ...SAMPLE.A, avoid: [product, face] });
    expect(t.warnings).toEqual([`El texto queda a menos de ${FACE_GAP} px de la cara.`]);
    expect(t.box.x + t.box.w).toBeLessThanOrEqual(productX * THUMB_WIDTH);
  });

  it("si ni al mínimo deja libre el producto, lo avisa", () => {
    const product = { label: "product" as const, x: 0, y: 0, w: 0.6, h: 1 };
    const t = schemeTextLayout({ scheme: "A", ...SAMPLE.A, avoid: [product] });
    expect(t.size).toBe(TEXT_SIZE.min);
    expect(t.warnings).toEqual(["El texto tapa parte del producto."]);
  });

  it("un texto que no cabe al mínimo se reduce y lo avisa", () => {
    const t = schemeTextLayout({ scheme: "D", text: "Mejor espera al nuevo", accent: "espera" });
    expect(t.size).toBeLessThan(TEXT_SIZE.min);
    expect(t.warnings).toContain(`El texto no cabe a ${TEXT_SIZE.min} px de cuerpo y se redujo.`);
    expect(inside(t.box, schemeLayout("D").zone)).toBe(true);
  });
});

describe("composición de la miniatura", () => {
  it("degradado negro solo en E y F; sombra suave en las letras y sin mancha", () => {
    for (const scheme of SCHEME_IDS) {
      const svg = overlaySvg(['<path d="M0 0"/>'], scheme);
      expect(svg.includes('data-gradient="1"')).toBe(scheme === "E" || scheme === "F");
      expect(svg).toContain("feDropShadow");
      expect(svg).not.toContain("data-scrim");
    }
    expect(overlaySvg([], "E")).toContain('cy="100%"');
    expect(overlaySvg([], "F")).toContain('cy="0%"');
  });

  it("JPG de 1280 × 720 y menos de 2 MB con el texto en su zona", async () => {
    const res = await composeScheme(await gray(), { scheme: "C", ...SAMPLE.C, colors });
    const meta = await sharp(res.jpg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", THUMB_WIDTH, THUMB_HEIGHT]);
    expect(res.jpg.length).toBeLessThan(2 * 1024 * 1024);
    expect(res.warnings).toEqual([]);
    const orange = await orangeBox(res.jpg);
    expect(orange.n).toBeGreaterThan(1000);
    expect(inside(orange.box, res.textBox)).toBe(true);
    expect(orange.box.x).toBeGreaterThanOrEqual(THUMB_WIDTH * 0.6);
  }, 30_000);

  it("E oscurece abajo a la izquierda y deja clara la esquina opuesta", async () => {
    const res = await composeScheme(await gray(), { scheme: "E", ...SAMPLE.E, colors });
    const px = async (left: number, top: number) => {
      const { data } = await sharp(res.jpg)
        .extract({ left, top, width: 8, height: 8 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data[0]!;
    };
    expect(await px(20, 700)).toBeLessThan(40);
    expect(await px(900, 200)).toBeGreaterThan(80);
  }, 30_000);

  it("la prueba de móvil es de 168 × 94", async () => {
    const res = await composeScheme(await gray(), { scheme: "A", ...SAMPLE.A, colors });
    const meta = await sharp(await mobilePreview(res.jpg)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 168, 94]);
  }, 30_000);

  it("reduce y orienta las referencias", async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: "#336699" },
    })
      .png()
      .toBuffer();
    const meta = await sharp(await prepareReference(big)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1536, 1024]);
  });
});
