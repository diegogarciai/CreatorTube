import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { readMigrations } from "../src/migrations";

export default async function setup({ provide }: { provide: (key: string, value: string) => void }) {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL no definida: corre las pruebas con `pnpm test`.");
  const dbName = `planificador_test_${Date.now()}`;
  const root = new pg.Client({ connectionString: base });
  await root.connect();
  await root.query(`create database ${dbName}`);
  await root.end();

  const url = new URL(base);
  url.pathname = `/${dbName}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
  for (const m of readMigrations()) {
    try {
      await client.query(m.sql);
    } catch (err) {
      throw new Error(`Falló la migración ${m.name}: ${(err as Error).message}`);
    }
  }
  await client.end();
  provide("testDatabaseUrl", url.toString());

  return async () => {
    const r = new pg.Client({ connectionString: base });
    await r.connect();
    await r.query(`drop database if exists ${dbName} with (force)`);
    await r.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}
