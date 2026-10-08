import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeWav, SAMPLE_RATE, SFX_NAMES, synthesize } from "../src/sfx";

const DURATION_MS = { whoosh: 350, out: 250, pop: 80, tick: 25, settle: 180 };

describe("efectos de sonido", () => {
  it("son deterministas, con su duración y sin saturar", () => {
    for (const name of SFX_NAMES) {
      const a = synthesize(name);
      expect(Array.from(a)).toEqual(Array.from(synthesize(name)));
      expect(a.length).toBe(Math.round((SAMPLE_RATE * DURATION_MS[name]) / 1000));
      const peak = Math.max(...Array.from(a, Math.abs));
      expect(peak).toBeGreaterThan(0.45);
      expect(peak).toBeLessThanOrEqual(0.5 + 1e-6);
      // Termina en silencio: sin clic al cortar.
      expect(Math.abs(a[a.length - 1]!)).toBeLessThan(0.01);
    }
  });

  it("los WAV de public/sfx son los que genera el sintetizador (pnpm sfx)", () => {
    for (const name of SFX_NAMES) {
      const expected = encodeWav(synthesize(name));
      const file = new Uint8Array(readFileSync(join(__dirname, `../public/sfx/${name}.wav`)));
      expect(file.length).toBe(expected.length);
      const a = new DataView(file.buffer, file.byteOffset);
      const b = new DataView(expected.buffer);
      expect(file.subarray(0, 44)).toEqual(expected.subarray(0, 44));
      // Tolera 1 LSB por diferencias de coma flotante entre máquinas.
      for (let i = 44; i < file.length; i += 2) {
        expect(Math.abs(a.getInt16(i, true) - b.getInt16(i, true))).toBeLessThanOrEqual(1);
      }
    }
  });

  it("el WAV es PCM de 16 bits, mono, 48 kHz", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]));
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(48_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect([1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([32767, -32767, 32767]);
  });
});
