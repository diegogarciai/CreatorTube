import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** Token del enlace de invitación y su hash (igual a public.hash_invitation_token). */
export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
