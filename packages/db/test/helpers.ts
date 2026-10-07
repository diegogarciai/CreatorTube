import pg from "pg";
import { inject } from "vitest";

export const pool = new pg.Pool({ connectionString: inject("testDatabaseUrl"), max: 4 });

/** Consulta como superusuario (equivale a la service role / migraciones). */
export async function sql<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return (await pool.query<T>(text, params)).rows;
}

export type Q = <T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/** Ejecuta `fn` como un usuario autenticado, con RLS activo, en una transacción. */
export async function as<R>(userId: string | null, fn: (q: Q) => Promise<R>): Promise<R> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    if (userId)
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const q: Q = async (text, params = []) => (await client.query(text, params)).rows;
    const result = await fn(q);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

let counter = 0;
export async function createUser(prefix = "user"): Promise<{ id: string; email: string }> {
  counter++;
  const email = `${prefix}${counter}-${Date.now()}@example.com`;
  const [row] = await sql<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, { full_name: prefix }],
  );
  return { id: row!.id, email };
}

export async function createWorkspace(ownerId: string, name = "Espacio") {
  const [row] = await sql<{ id: string }>("select public.create_workspace_for($1, $2) as id", [
    ownerId,
    name,
  ]);
  return row!.id;
}

export async function addMember(
  workspaceId: string,
  userId: string,
  role: string,
  channelIds: string[] | null = null,
) {
  await sql(
    "insert into public.memberships (workspace_id, user_id, role, channel_ids) values ($1, $2, $3, $4)",
    [workspaceId, userId, role, channelIds],
  );
}

export async function createChannel(workspaceId: string, name = "Canal", prefix = "EP") {
  const [row] = await sql<{ id: string }>(
    "insert into public.channels (workspace_id, name, code_prefix, timezone) values ($1, $2, $3, 'America/Bogota') returning id",
    [workspaceId, name, prefix],
  );
  return row!.id;
}

export async function createEpisode(
  channelId: string,
  title = "Episodio",
  extra: Record<string, unknown> = {},
) {
  const cols = ["channel_id", "title", ...Object.keys(extra)];
  const vals = [channelId, title, ...Object.values(extra)];
  const [row] = await sql<{ id: string }>(
    `insert into public.episodes (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    vals,
  );
  return row!.id;
}
