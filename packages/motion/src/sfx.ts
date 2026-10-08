/**
 * Los efectos de sonido de las ayudas, sintetizados por código: sin licencias
 * ni archivos de terceros. Sobrios como la marca (sin rebotes, brillos ni
 * glitch). El ruido sale de un generador con semilla fija, así que cada sonido
 * es siempre el mismo. `scripts/make-sfx.ts` los escribe en `public/sfx`.
 */

export const SAMPLE_RATE = 48_000;
export const SFX_NAMES = ["whoosh", "pop", "tick", "settle", "out"] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** Pico de cada sonido (−6 dBFS); el volumen final lo baja cada cue. */
const PEAK = 0.5;

/** Generador pseudoaleatorio con semilla (mulberry32), en [-1, 1). */
function noise(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const samples = (ms: number) => Math.round((SAMPLE_RATE * ms) / 1000);

/** Ruido por un pasabanda que barre de `from` a `to` Hz, con la envolvente dada. */
function sweep(ms: number, from: number, to: number, env: (t: number) => number, seed: number) {
  const n = samples(ms);
  const out = new Float32Array(n);
  const rnd = noise(seed);
  let low = 0;
  let band = 0;
  const damp = 0.9;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const fc = from * Math.pow(to / from, t);
    const f = 2 * Math.sin((Math.PI * fc) / SAMPLE_RATE);
    // Filtro de estado variable (Chamberlin).
    low += f * band;
    const high = rnd() - low - damp * band;
    band += f * high;
    out[i] = band * env(t);
  }
  return out;
}

/** Seno con caída de tono exponencial y decaimiento `tau` (ms). */
function tone(ms: number, from: number, to: number, tau: number, attack: number, harmonic = 0) {
  const n = samples(ms);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const sec = i / SAMPLE_RATE;
    const freq = from * Math.pow(to / from, t);
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const env = Math.min(sec / (attack / 1000), 1) * Math.exp(-sec / (tau / 1000));
    out[i] = (Math.sin(phase) + harmonic * Math.sin(2 * phase)) * env;
  }
  return out;
}

/** Normaliza al pico y suaviza los últimos 5 ms para que no haga clic. */
function finish(buf: Float32Array) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const gain = max > 0 ? PEAK / max : 0;
  const fade = Math.min(samples(5), buf.length);
  for (let i = 0; i < buf.length; i++) {
    const tail = buf.length - i;
    buf[i] = buf[i]! * gain * (tail < fade ? tail / fade : 1);
  }
  return buf;
}

const bell = (peak: number) => (t: number) =>
  t < peak
    ? Math.sin((t / peak) * (Math.PI / 2)) ** 2
    : Math.cos(((t - peak) / (1 - peak)) * (Math.PI / 2)) ** 2;

/** Las muestras de cada sonido (mono, 48 kHz, en [-1, 1]). */
export function synthesize(name: SfxName): Float32Array {
  switch (name) {
    case "whoosh":
      return finish(sweep(350, 300, 2500, bell(0.6), 1));
    case "out":
      return finish(sweep(250, 2000, 300, bell(0.3), 2));
    case "pop":
      return finish(tone(80, 900, 500, 20, 3, 0.2));
    case "tick": {
      const buf = tone(25, 2400, 2200, 4, 0.5);
      const rnd = noise(3);
      for (let i = 0; i < samples(2); i++) buf[i] = buf[i]! + rnd() * 0.3;
      return finish(buf);
    }
    case "settle":
      return finish(tone(180, 110, 70, 50, 5, 0.3));
  }
}

/** WAV PCM de 16 bits, mono. */
export function encodeWav(buf: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + buf.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + buf.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, buf.length * 2, true);
  buf.forEach((v, i) => {
    view.setInt16(44 + i * 2, Math.round(Math.min(Math.max(v, -1), 1) * 32767), true);
  });
  return bytes;
}
