import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  composeThumbnail,
  prepareReference,
  textOverlaySvg,
  THUMB_HEIGHT,
  THUMB_WIDTH,
} from "../src/lib/compose-thumbnail";

const colors = { text: "#FFFFFF", accent: "#FF7A29" };

/** Una imagen 16:9 como la de Gemini (1376 × 768), oscura y con ruido. */
async function fakeBase() {
  const w = 1376;
  const h = 768;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = 15 + ((i * 7919) % 23);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

/** Cuántos píxeles naranjas hay en cada mitad. */
async function orangeBySide(jpg: Buffer) {
  const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });
  let left = 0;
  let right = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (r > 200 && g > 90 && g < 160 && b < 80) {
        if (x < info.width / 2) left++;
        else right++;
      }
    }
  }
  return { left, right };
}

describe("composición de la miniatura", () => {
  it("pone el texto de la marca del lado pedido, en JPG de 1280 × 720 y menos de 2 MB", async () => {
    const base = await fakeBase();
    for (const side of ["left", "right"] as const) {
      const jpg = await composeThumbnail(base, {
        lines: ["¿Pagar más", "por RAM?"],
        accent: "RAM?",
        side,
        colors,
      });
      const meta = await sharp(jpg).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", THUMB_WIDTH, THUMB_HEIGHT]);
      expect(jpg.length).toBeLessThan(2 * 1024 * 1024);
      const orange = await orangeBySide(jpg);
      const [near, far] =
        side === "left" ? [orange.left, orange.right] : [orange.right, orange.left];
      expect(near).toBeGreaterThan(1000);
      expect(far).toBe(0);
    }
  }, 30_000);

  it("una sola palabra en naranja y el texto ocupa casi la mitad del ancho", () => {
    const svg = textOverlaySvg({ lines: ["8 GB vs", "16 GB"], accent: "GB", side: "left", colors });
    expect(svg.match(/fill="#FF7A29"/g)).toHaveLength(1);
    expect(svg.match(/<path /g)).toHaveLength(5);
    const question = textOverlaySvg({
      lines: ["¿Pagar más", "por RAM?"],
      accent: "RAM?",
      side: "right",
      colors,
    });
    expect(question.match(/fill="#FF7A29"/g)).toHaveLength(1);
    expect(question.match(/<path /g)).toHaveLength(5);
    expect(svg).toContain("feDropShadow");
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
