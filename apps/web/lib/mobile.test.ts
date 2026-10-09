import { describe, expect, it } from "vitest";
import {
  actionArgs,
  bearerToken,
  decodeMobileTicket,
  encodeMobileTicket,
  MOBILE_TICKET_TTL_MS,
  mobileYouTubeResult,
  nextErrorStatus,
} from "./mobile";

describe("api móvil", () => {
  it("lee el token Bearer", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer  xyz ")).toBe("xyz");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
  });

  it("toma los argumentos de la acción", () => {
    expect(actionArgs({ args: ["ep", { from: "fix" }] })).toEqual(["ep", { from: "fix" }]);
    expect(actionArgs({})).toEqual([]);
    expect(actionArgs({ args: "ep" })).toBeNull();
    expect(actionArgs(null)).toBeNull();
    expect(actionArgs({ args: Array.from({ length: 9 }) })).toBeNull();
  });

  it("traduce redirect y notFound a 401 y 404", () => {
    expect(nextErrorStatus({ digest: "NEXT_REDIRECT;replace;/login;307;" })).toBe(401);
    expect(nextErrorStatus({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })).toBe(404);
    expect(nextErrorStatus(new Error("x"))).toBeNull();
  });

  describe("ticket para conectar YouTube", () => {
    const key = Buffer.alloc(32, 7);
    const data = { workspaceId: "ws", userId: "u1", channelId: "ch" };
    const now = 1_000_000;

    it("vuelve a leer lo que firmó mientras no venza", () => {
      const ticket = encodeMobileTicket(data, key, now);
      expect(decodeMobileTicket(ticket, key, now + 1000)).toEqual({
        ...data,
        exp: now + MOBILE_TICKET_TTL_MS,
      });
      expect(decodeMobileTicket(ticket, key, now + MOBILE_TICKET_TTL_MS + 1)).toBeNull();
    });

    it("conserva el permiso pedido para responder comentarios", () => {
      const ticket = encodeMobileTicket({ ...data, scope: "comments" }, key, now);
      expect(decodeMobileTicket(ticket, key, now)?.scope).toBe("comments");
    });

    it("rechaza otra clave o un ticket cambiado", () => {
      const ticket = encodeMobileTicket(data, key, now);
      expect(decodeMobileTicket(ticket, Buffer.alloc(32, 8), now)).toBeNull();
      const [, signature] = ticket.split(".");
      const forged = Buffer.from(
        JSON.stringify({ ...data, userId: "otro", exp: now + 60_000 }),
      ).toString("base64url");
      expect(decodeMobileTicket(`${forged}.${signature}`, key, now)).toBeNull();
      expect(decodeMobileTicket(`${ticket}.x`, key, now)).toBeNull();
      expect(decodeMobileTicket("", key, now)).toBeNull();
    });

    it("arma la vuelta a la app sin parámetros vacíos", () => {
      expect(mobileYouTubeResult({ channel: "ch", new: undefined })).toBe(
        "planificador://youtube?channel=ch",
      );
      expect(mobileYouTubeResult({ error: "youtube_denied" })).toBe(
        "planificador://youtube?error=youtube_denied",
      );
      expect(mobileYouTubeResult({})).toBe("planificador://youtube");
    });
  });
});
