import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@planificador/db";
import { env } from "../env";

/**
 * Sesión de la app móvil: el token de Supabase llega en `Authorization: Bearer`
 * en lugar de cookies. Mientras dura una petición de `/api/mobile`, el cliente
 * del servidor usa este token, así que RLS y los permisos son los mismos que en
 * la web.
 */
export const bearerSession = new AsyncLocalStorage<{ token: string }>();

export function createBearerClient(token: string) {
  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
