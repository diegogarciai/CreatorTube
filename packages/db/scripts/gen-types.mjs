#!/usr/bin/env node
// Genera src/types.ts (formato de `supabase gen types`) a partir de las
// migraciones, sin Docker: aplica todo en un Postgres de prueba e inspecciona
// el catálogo. Uso: node scripts/with-postgres.mjs node scripts/gen-types.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.DATABASE_URL;
const dbName = `planificador_types_${Date.now()}`;

const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`create database ${dbName}`);
await admin.end();
const url = new URL(base);
url.pathname = `/${dbName}`;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();

try {
  await db.query(readFileSync(join(root, "test", "supabase-shim.sql"), "utf8"));
  const migDir = join(root, "supabase", "migrations");
  for (const f of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(join(migDir, f), "utf8"));
  }

  const enums = (
    await db.query(`
      select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as values
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' group by t.typname order by t.typname`)
  ).rows;
  const enumNames = new Set(enums.map((e) => e.name));

  const columns = (
    await db.query(`
      select c.relname as table, a.attname as column, a.attnum,
        not a.attnotnull as nullable,
        (a.atthasdef or a.attidentity <> '') as has_default,
        a.attidentity = 'a' as identity_always,
        t.typname as type, t.typcategory as category,
        et.typname as elem_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      join pg_type t on t.oid = a.atttypid
      left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname, a.attnum`)
  ).rows;

  const fks = (
    await db.query(`
      select con.conname as name, c.relname as table, rc.relname as ref_table,
        array(select attname::text from pg_attribute where attrelid = con.conrelid and attnum = any(con.conkey) order by attnum) as columns,
        array(select attname::text from pg_attribute where attrelid = con.confrelid and attnum = any(con.confkey) order by attnum) as ref_columns,
        exists (
          select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique
            and (select array_agg(k order by k) from unnest(i.indkey::int2[]) k) = (select array_agg(k order by k) from unnest(con.conkey) k)
        ) as one_to_one
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_class rc on rc.oid = con.confrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_namespace rn on rn.oid = rc.relnamespace
      where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
      order by c.relname, con.conname`)
  ).rows;

  const functions = (
    await db.query(`
      select p.proname as name, p.proretset as returns_set,
        pg_get_function_identity_arguments(p.oid) as identity,
        p.proargnames as arg_names, p.proargmodes::text[] as arg_modes,
        array(select format_type(x, null) from unnest(p.proallargtypes) x) as all_types,
        array(select format_type(x, null) from unnest(p.proargtypes::oid[]) x) as in_types,
        format_type(p.prorettype, null) as return_type,
        p.pronargdefaults as n_defaults
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and format_type(p.prorettype, null) <> 'trigger'
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
      order by p.proname`)
  ).rows;

  const scalar = (type) => {
    const t = type.replace(/^public\./, "");
    if (enumNames.has(t)) return `Database["public"]["Enums"]["${t}"]`;
    if (["uuid", "text", "date", "timestamptz", "timestamp with time zone", "varchar", "character varying", "citext", "time", "bytea"].includes(t))
      return "string";
    if (["int2", "int4", "int8", "smallint", "integer", "bigint", "float4", "float8", "real", "double precision", "numeric"].includes(t))
      return "number";
    if (["bool", "boolean"].includes(t)) return "boolean";
    if (["json", "jsonb"].includes(t)) return "Json";
    if (t === "void") return "undefined";
    return "unknown";
  };
  const fromFormatType = (ft) => (ft.endsWith("[]") ? `${scalar(ft.slice(0, -2))}[]` : scalar(ft));
  const colType = (c) => (c.category === "A" ? `${scalar(c.elem_type.replace(/^_/, ""))}[]` : scalar(c.type));

  const tables = new Map();
  for (const c of columns) {
    if (!tables.has(c.table)) tables.set(c.table, []);
    tables.get(c.table).push(c);
  }

  const lines = [];
  const p = (s = "") => lines.push(s);
  p("// Archivo generado por scripts/gen-types.mjs a partir de las migraciones. No editar a mano.");
  p("// Regenerar con: pnpm --filter @planificador/db gen:types");
  p();
  p("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
  p();
  p("export type Database = {");
  p("  public: {");
  p("    Tables: {");
  for (const [table, cols] of tables) {
    p(`      ${table}: {`);
    p("        Row: {");
    for (const c of cols) p(`          ${c.column}: ${colType(c)}${c.nullable ? " | null" : ""};`);
    p("        };");
    p("        Insert: {");
    // Columnas que llenan los triggers (espacio y canal heredados, número y código del episodio).
    const hasChannel = cols.some((c) => c.column === "channel_id");
    const hasEpisode = cols.some((c) => c.column === "episode_id");
    const filledByTrigger = (col) =>
      (col === "workspace_id" && (hasChannel || hasEpisode) && table !== "channels" && table !== "tasks" && table !== "usage_ledger" && table !== "activity_log") ||
      (col === "channel_id" && ["episode_checklist_items", "episode_evaluations"].includes(table)) ||
      (table === "episodes" && (col === "number" || col === "code"));
    for (const c of cols) {
      if (c.identity_always) p(`          ${c.column}?: never;`);
      else {
        const optional = c.nullable || c.has_default || filledByTrigger(c.column);
        p(`          ${c.column}${optional ? "?" : ""}: ${colType(c)}${c.nullable ? " | null" : ""};`);
      }
    }
    p("        };");
    p("        Update: {");
    for (const c of cols) {
      if (c.identity_always) p(`          ${c.column}?: never;`);
      else p(`          ${c.column}?: ${colType(c)}${c.nullable ? " | null" : ""};`);
    }
    p("        };");
    p("        Relationships: [");
    for (const fk of fks.filter((f) => f.table === table)) {
      p("          {");
      p(`            foreignKeyName: "${fk.name}";`);
      p(`            columns: [${fk.columns.map((x) => `"${x}"`).join(", ")}];`);
      p(`            isOneToOne: ${fk.one_to_one};`);
      p(`            referencedRelation: "${fk.ref_table}";`);
      p(`            referencedColumns: [${fk.ref_columns.map((x) => `"${x}"`).join(", ")}];`);
      p("          },");
    }
    p("        ];");
    p("      };");
  }
  p("    };");
  p("    Views: { [_ in never]: never };");
  p("    Functions: {");
  for (const f of functions) {
    const names = f.arg_names ?? [];
    const modes = f.arg_modes ?? names.map(() => "i");
    const allTypes = f.all_types.length ? f.all_types : f.in_types;
    const inArgs = [];
    const outCols = [];
    names.forEach((n, i) => {
      const mode = modes[i];
      if (mode === "i" || mode === "b") inArgs.push({ name: n, type: allTypes[i] });
      if (mode === "o" || mode === "t" || mode === "b") outCols.push({ name: n, type: allTypes[i] });
    });
    const firstDefault = inArgs.length - f.n_defaults;
    p(`      ${f.name}: {`);
    p(
      `        Args: ${
        inArgs.length
          ? `{ ${inArgs.map((a, i) => `${a.name}${i >= firstDefault ? "?" : ""}: ${fromFormatType(a.type)}`).join("; ")} }`
          : "Record<PropertyKey, never>"
      };`,
    );
    let ret;
    if (outCols.length) ret = `{ ${outCols.map((c) => `${c.name}: ${fromFormatType(c.type)}`).join("; ")} }[]`;
    else ret = fromFormatType(f.return_type) + (f.returns_set ? "[]" : "");
    p(`        Returns: ${ret};`);
    p("      };");
  }
  p("    };");
  p("    Enums: {");
  for (const e of enums) p(`      ${e.name}: ${e.values.map((v) => `"${v}"`).join(" | ")};`);
  p("    };");
  p("    CompositeTypes: { [_ in never]: never };");
  p("  };");
  p("};");
  p();
  p('type PublicSchema = Database["public"];');
  p('export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];');
  p('export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];');
  p('export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];');
  p('export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];');
  writeFileSync(join(root, "src", "types.ts"), lines.join("\n") + "\n");
  console.log(`Tipos generados: ${tables.size} tablas, ${functions.length} funciones, ${enums.length} enums.`);
} finally {
  await db.end();
  const cleanup = new pg.Client({ connectionString: base });
  await cleanup.connect();
  await cleanup.query(`drop database if exists ${dbName} with (force)`);
  await cleanup.end();
}
