import { randomToken, sign, verifySignature } from "./crypto";

/**
 * OAuth de Google por canal. Solo permisos de lectura en la Fase 1; los de
 * escritura (responder comentarios, miniatura, privacidad) se piden con
 * autorización incremental en la Fase 4.
 */
export const YOUTUBE_READ_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthState {
  workspaceId: string;
  userId: string;
  /** Canal existente a reconectar; si falta, se crea uno nuevo. */
  channelId?: string;
  nonce: string;
  /** Vencimiento en milisegundos desde época. */
  exp: number;
}

export function createState(
  data: Omit<OAuthState, "nonce" | "exp">,
  secret: Buffer,
  now = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomToken(16);
  const payload: OAuthState = { ...data, nonce, exp: now + 10 * 60_000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: `${encoded}.${sign(encoded, secret)}`, nonce };
}

/**
 * Verifica firma, vencimiento y que el nonce coincida con la cookie del
 * navegador que inició el flujo (protección CSRF).
 */
export function verifyState(
  state: string,
  secret: Buffer,
  expectedNonce: string | undefined,
  now = Date.now(),
): OAuthState | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || !verifySignature(encoded, signature, secret)) return null;
  let data: OAuthState;
  try {
    data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (data.exp < now || !expectedNonce || data.nonce !== expectedNonce) return null;
  return data;
}

export function buildAuthUrl(
  config: GoogleOAuthConfig,
  state: string,
  options: { loginHint?: string; scopes?: readonly string[] } = {},
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: (options.scopes ?? YOUTUBE_READ_SCOPES).join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    // Fuerza el refresh_token aunque ya se haya autorizado antes.
    prompt: "consent select_account",
    state,
  });
  if (options.loginHint) params.set("login_hint", options.loginHint);
  return `${AUTH_URL}?${params}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OAuthError";
  }

  /** El usuario revocó el acceso o el token ya no sirve: hay que reconectar. */
  get needsReauth(): boolean {
    return this.code === "invalid_grant" || this.status === 401;
  }
}

type Fetch = typeof fetch;

async function tokenRequest(
  body: URLSearchParams,
  fetchImpl: Fetch,
  now: number,
): Promise<TokenSet> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new OAuthError(
      String(json.error_description ?? json.error ?? "Error de OAuth"),
      String(json.error ?? "unknown"),
      res.status,
    );
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresAt: new Date(now + Number(json.expires_in ?? 3600) * 1000),
    scopes: typeof json.scope === "string" ? json.scope.split(" ") : [],
  };
}

export function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    fetchImpl,
    now,
  );
}

export function refreshAccessToken(
  config: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  return tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
    fetchImpl,
    now,
  );
}

/** Revoca el acceso en Google (desconexión limpia). No falla si ya estaba revocado. */
export async function revokeToken(token: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  const res = await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  return res.ok || res.status === 400;
}

export function hasScopes(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((s) => granted.includes(s));
}
