import { describe, expect, it } from "vitest";
import { actionArgs, bearerToken, nextErrorStatus } from "./mobile";

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
});
