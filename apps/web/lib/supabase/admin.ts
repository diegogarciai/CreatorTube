import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@planificador/db";
import { env } from "../env";

/**
 * Cliente con la service role: ignora RLS. Úsalo solo en el servidor para lo
 * que el cliente nunca debe tocar (tokens de YouTube, sincronización, ICS
 * público) y siempre después de verificar permisos.
 */
export function createAdminClient() {
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
