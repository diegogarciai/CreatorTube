import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@planificador/db";
import { env } from "../env";
import { bearerSession, createBearerClient } from "./bearer";

/** Cliente con la sesión del usuario: todas las consultas pasan por RLS. */
export async function createClient() {
  // Petición de la app móvil: la sesión viene en el encabezado, no en cookies.
  const bearer = bearerSession.getStore();
  if (bearer) return createBearerClient(bearer.token) as unknown as CookieClient;
  return createCookieClient();
}

async function createCookieClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Llamado desde un Server Component: el proxy ya refresca la sesión.
        }
      },
    },
  });
}

type CookieClient = Awaited<ReturnType<typeof createCookieClient>>;
export type ServerClient = CookieClient;
