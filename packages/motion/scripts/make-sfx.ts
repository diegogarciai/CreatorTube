// Escribe los efectos de sonido en public/sfx: `pnpm --filter @planificador/motion sfx`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWav, SFX_NAMES, synthesize } from "../src/sfx.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../public/sfx");
mkdirSync(dir, { recursive: true });
for (const name of SFX_NAMES) {
  const wav = encodeWav(synthesize(name));
  writeFileSync(join(dir, `${name}.wav`), wav);
  console.log(`${name}.wav  ${wav.length} bytes`);
}
