import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  composeThumbnail,
  findTextZone,
  prepareReference,
  textOverlaySvg,
  THUMB_HEIGHT,
  THUMB_WIDTH,
} from "../src/lib/compose-thumbnail";

const colors = { text: "#FFFFFF", accent: "#FF7A29" };

/**
 * Una imagen 1280 × 720 oscura con «sujetos» claros y con detalle (rayas) en
 * las zonas dadas, como la cara o el producto de una foto.
 */
async function scene(busy: { x: number; y: number; w: number; h: number }[]) {
  const stripes = busy
    .map(
      (b) =>
        `<pattern id="p${b.x}${b.y}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="6" height="12" fill="#e0c0a0"/><rect x="6" width="6" height="12" fill="#404040"/></pattern>` +
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#p${b.x}${b.y})"/>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="#111213"/>${stripes}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Cuántos píxeles naranjas hay en cada mitad y en cada tercio de alto. */
async function orangeBy(jpg: Buffer) {
  const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });
  const out = { left: 0, right: 0, top: 0, middle: 0, bottom: 0 };
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (r > 200 && g > 90 && g < 160 && b < 80) {
        if (x < info.width / 2) out.left++;
        else out.right++;
        if (y < info.height / 3) out.top++;
        else if (y < (2 * info.height) / 3) out.middle++;
        else out.bottom++;
      }
    }
  }
  return out;
}

const block = () => ({ width: 560, height: 280 });

describe("zona libre para el texto", () => {
  it("evita el lado donde está el sujeto", async () => {
    const img = await scene([{ x: 680, y: 0, w: 600, h: 720 }]);
    expect(await findTextZone(img, block)).toMatchObject({
      side: "left",
      vertical: "middle",
      scale: 1,
    });
  });

  it("busca la altura libre cuando los dos lados tienen algo", async () => {
    // Izquierda ocupada entera; a la derecha solo queda libre abajo.
    const img = await scene([
      { x: 0, y: 0, w: 640, h: 720 },
      { x: 640, y: 0, w: 640, h: 430 },
    ]);
    expect(await findTextZone(img, block)).toMatchObject({ side: "right", vertical: "bottom" });
  });

  it("respeta lo que la persona fijó y busca solo en lo demás", async () => {
    // A la derecha, el sujeto ocupa de la mitad hacia abajo.
    const img = await scene([{ x: 640, y: 330, w: 640, h: 390 }]);
    expect(await findTextZone(img, block, { side: "right" })).toMatchObject({
      side: "right",
      vertical: "top",
    });
    expect(await findTextZone(img, block, { vertical: "middle" })).toMatchObject({
      side: "left",
      vertical: "middle",
    });
  });

  it("no tapa lo que Claude ubicó, aunque parezca fondo vacío", async () => {
    // Una pantalla oscura a la izquierda no tiene detalle, pero es el producto.
    const img = await scene([]);
    const avoid = [{ label: "product" as const, x: 0, y: 0.3, w: 0.5, h: 0.4 }];
    expect(await findTextZone(img, block, {}, avoid)).toMatchObject({ side: "right" });
    const face = [{ label: "face" as const, x: 0.55, y: 0, w: 0.45, h: 0.5 }];
    expect(await findTextZone(img, block, {}, [...avoid, face[0]!])).toMatchObject({
      side: "right",
      vertical: "bottom",
    });
  });

  it("achica el texto si así deja de tapar el producto", async () => {
    // Producto ancho al centro: arriba a la izquierda solo cabe un bloque menor.
    const img = await scene([
      { x: 0, y: 300, w: 1280, h: 420 },
      { x: 700, y: 0, w: 580, h: 300 },
    ]);
    const measure = (scale: number) => ({ width: 560 * scale, height: 300 * scale });
    const zone = await findTextZone(img, measure);
    expect(zone).toMatchObject({ side: "left", vertical: "top" });
    expect(zone.scale).toBeLessThan(1);
  });
});

describe("composición de la miniatura", () => {
  it("pone el texto en la zona libre, en JPG de 1280 × 720 y menos de 2 MB", async () => {
    // El producto en el centro-derecha y la cara arriba a la derecha.
    const img = await scene([
      { x: 560, y: 260, w: 420, h: 300 },
      { x: 900, y: 40, w: 300, h: 380 },
    ]);
    const { jpg, placement } = await composeThumbnail(img, {
      lines: ["¿Pagar más", "por RAM?"],
      accent: "RAM?",
      colors,
    });
    expect(placement.side).toBe("left");
    const meta = await sharp(jpg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", THUMB_WIDTH, THUMB_HEIGHT]);
    expect(jpg.length).toBeLessThan(2 * 1024 * 1024);
    const orange = await orangeBy(jpg);
    expect(orange.left).toBeGreaterThan(1000);
    expect(orange.right).toBe(0);
  }, 30_000);

  it("con lado y altura fijos, el texto va ahí", async () => {
    const img = await scene([]);
    const { jpg, placement } = await composeThumbnail(img, {
      lines: ["No compres", "8 GB"],
      accent: "GB",
      side: "right",
      vertical: "bottom",
      colors,
    });
    expect(placement).toEqual({ side: "right", vertical: "bottom" });
    const orange = await orangeBy(jpg);
    expect(orange.right).toBeGreaterThan(1000);
    expect(orange.left).toBe(0);
    expect(orange.bottom).toBeGreaterThan(orange.top + orange.middle);
  }, 30_000);

  it("una sola palabra en naranja, signos en blanco y sombra detrás del bloque", () => {
    const svg = textOverlaySvg({
      lines: ["8 GB vs", "16 GB"],
      accent: "GB",
      side: "left",
      vertical: "middle",
      colors,
    });
    expect(svg.match(/fill="#FF7A29"/g)).toHaveLength(1);
    expect(svg.match(/<path /g)).toHaveLength(5);
    expect(svg).toContain("feDropShadow");
    expect(svg).toContain('data-scrim="1"');
    const question = textOverlaySvg({
      lines: ["¿Pagar más", "por RAM?"],
      accent: "RAM?",
      side: "right",
      vertical: "top",
      colors,
    });
    expect(question.match(/fill="#FF7A29"/g)).toHaveLength(1);
    expect(question.match(/<path /g)).toHaveLength(5);
  });

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
