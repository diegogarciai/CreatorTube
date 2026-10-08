import { describe, expect, it } from "vitest";
import {
  APIConnectionError,
  APIError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { ErrorType } from "@anthropic-ai/sdk/resources/shared";
import { aiErrorKey, isTransientAiError } from "../src/errors";
import { AiRefusalError } from "../src/generate";

const h = new Headers();
const inStream = (type: ErrorType) =>
  new APIError(undefined, { type: "error", error: { type, message: "x" } }, undefined, h, type);

describe("errores de la API", () => {
  it.each([
    ["saturado a mitad del stream", inStream("overloaded_error"), true, "errors.ai_overloaded"],
    ["529", new APIError(529, {}, "x", h, "overloaded_error"), true, "errors.ai_overloaded"],
    [
      "429",
      new RateLimitError(429, {}, "x", h, "rate_limit_error"),
      true,
      "errors.ai_rate_limited",
    ],
    ["500", new InternalServerError(500, {}, "x", h, "api_error"), true, "errors.ai_unavailable"],
    ["api_error en el stream", inStream("api_error"), true, "errors.ai_unavailable"],
    ["red", new APIConnectionError({ message: "x" }), true, "errors.ai_unavailable"],
    ["400", new BadRequestError(400, {}, "x", h, "invalid_request_error"), false, null],
    ["otro error en el stream", inStream("invalid_request_error"), false, null],
    ["negativa", new AiRefusalError("cyber"), false, "errors.ai_refusal"],
    ["error común", new Error("x"), false, null],
  ])("%s", (_name, err, transient, key) => {
    expect(isTransientAiError(err)).toBe(transient);
    expect(aiErrorKey(err)).toBe(key);
  });
});
