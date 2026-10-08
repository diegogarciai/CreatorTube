import { describe, expect, it } from "vitest";
import { aiConfigFor, pricesFor, resolveModel } from "../src/models";

const env = { AI_MODEL: "modelo-variable", AI_PRICE_INPUT_USD: "2", AI_PRICE_OUTPUT_USD: "10" };

describe("modelos por espacio y etapa", () => {
  it("usa el de la etapa, luego el por defecto del espacio y al final AI_MODEL", () => {
    const settings = { defaultModel: "modelo-a", stageModels: { script: "modelo-b" } };
    expect(resolveModel(env, settings, "script")).toBe("modelo-b");
    expect(resolveModel(env, settings, "study")).toBe("modelo-a");
    expect(resolveModel(env, { defaultModel: null, stageModels: {} }, "study")).toBe(
      "modelo-variable",
    );
    expect(resolveModel(env, null, "direction")).toBe("modelo-variable");
    expect(() => resolveModel({}, null, "script")).toThrow(/Administración/);
    expect(aiConfigFor({ ...env, AI_FALLBACKS: "off" }, settings, "script")).toEqual({
      model: "modelo-b",
      fallbacks: false,
    });
  });

  it("cobra con el precio del catálogo si está escrito; si no, con las variables", () => {
    const catalog = [
      { id: "modelo-a", inputPerMTok: 5, outputPerMTok: 25 },
      { id: "modelo-b", inputPerMTok: null, outputPerMTok: 15 },
    ];
    expect(pricesFor("modelo-a", catalog, env)).toEqual({ inputPerMTok: 5, outputPerMTok: 25 });
    expect(pricesFor("modelo-b", catalog, env)).toEqual({ inputPerMTok: 2, outputPerMTok: 15 });
    expect(pricesFor("otro", catalog, env)).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
  });
});
