import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Cifrado de tokens de Google con AES-256-GCM. La clave (32 bytes en base64)
 * vive en la variable TOKEN_ENCRYPTION_KEY, fuera de la base de datos.
 * Formato: `v1.<iv>.<tag>.<cifrado>` en base64url.
 */
const VERSION = "v1";

export function parseKey(base64Key: string | undefined): Buffer {
  if (!base64Key) throw new Error("Falta TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY debe ser de 32 bytes en base64");
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, enc] = payload.split(".");
  if (version !== VERSION || !iv || !tag || enc === undefined)
    throw new Error("Secreto cifrado inválido");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}

/** Firma corta HMAC-SHA256 para el `state` de OAuth. */
export function sign(value: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function verifySignature(value: string, signature: string, secret: Buffer): boolean {
  const expected = Buffer.from(sign(value, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
