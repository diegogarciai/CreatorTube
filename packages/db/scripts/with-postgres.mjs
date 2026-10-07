#!/usr/bin/env node
// Corre un comando con DATABASE_URL apuntando a un Postgres de prueba.
// Si DATABASE_URL ya existe (CI), lo usa; si no, levanta un clúster temporal
// con los binarios locales de Postgres (initdb/pg_ctl), sin Docker.
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, chmodSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Uso: with-postgres.mjs <comando> [...args]");
  process.exit(2);
}

function run() {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  return r.status ?? 1;
}

if (process.env.DATABASE_URL) process.exit(run());

function findBin(name) {
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const p = join(base, v, "bin", name);
      if (existsSync(p)) return p;
    }
  }
  return name; // en el PATH (macOS con Homebrew, etc.)
}

const isRoot = process.getuid?.() === 0;
const asPg = (bin, binArgs) =>
  isRoot
    ? execFileSync(
        "su",
        ["postgres", "-s", "/bin/sh", "-c", [bin, ...binArgs].map((a) => `'${a}'`).join(" ")],
        { stdio: "pipe" },
      )
    : execFileSync(bin, binArgs, { stdio: "pipe" });

const dir = mkdtempSync(join(tmpdir(), "planificador-pg-"));
chmodSync(dir, 0o777);
const data = join(dir, "data");
const port = String(54000 + Math.floor(Math.random() * 900));
let code = 1;
try {
  asPg(findBin("initdb"), [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth=trust",
    "-E",
    "UTF8",
    "--locale=C",
  ]);
  asPg(findBin("pg_ctl"), [
    "-D",
    data,
    "-o",
    `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`,
    "-w",
    "-l",
    join(dir, "log"),
    "start",
  ]);
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/postgres`;
  code = run();
} catch (err) {
  console.error("No se pudo levantar Postgres de prueba:", err.stderr?.toString() || err.message);
} finally {
  try {
    asPg(findBin("pg_ctl"), ["-D", data, "-m", "immediate", "stop"]);
  } catch {}
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
