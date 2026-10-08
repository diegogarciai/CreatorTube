import { describe, expect, it } from "vitest";
import {
  generateImage,
  geminiConfigFromEnv,
  ImageBlockedError,
  imageCostUsd,
  imagePrompt,
  normalizeText,
  scoreThumbnail,
  thumbnailBriefs,
  type ThumbnailDesign,
} from "../src";

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const design: ThumbnailDesign = {
  texto: "¿Pagar más por RAM?",
  escena: "Diego con dos portátiles",
  expresion: "duda",
  protagonista: "Diego",
  composicion: "Diego a la derecha",
  ayuda_visual: "ninguna",
  emocion: "pagar de más",
  titulo: "¿Vale la pena 16 GB?",
  texto_alternativo: "Diego compara dos portátiles",
};

const kit = {
  canvas: "#111213",
  glow: "#E87026",
  amberDeep: "#C65014",
  accent: "#FF7A29",
  thumbnailStyle: "Sistema A/B/C",
};

function fakeClient(output: unknown) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return { model: "m", stop_reason: "end_turn", usage, parsed_output: output };
        },
      },
    },
  } as never;
  return { client, calls };
}

describe("texto de la miniatura", () => {
  it("deja dos líneas y una palabra en naranja que exista", () => {
    expect(normalizeText(["¿Pagar más", "por RAM?"], "RAM")).toEqual({
      lines: ["¿Pagar más", "por RAM?"],
      accent: "RAM?",
    });
    expect(normalizeText(["No compres 8 GB"], "amarillo")).toEqual({
      lines: ["No compres", "8 GB"],
      accent: "GB",
    });
    expect(normalizeText(["  8 GB  vs ", " 16 GB"], "16")).toEqual({
      lines: ["8 GB vs", "16 GB"],
      accent: "16",
    });
  });
});

describe("brief de las miniaturas", () => {
  it("pide la escena, el texto y el lado en una sola llamada", async () => {
    const { client, calls } = fakeClient({
      briefs: [
        {
          idx: 0,
          scene: "A man between two laptops",
          lines: ["¿Pagar más", "por RAM?"],
          accent: "RAM",
          text_side: "left",
        },
      ],
    });
    const out = await thumbnailBriefs(
      client,
      { model: "m" },
      {
        designs: [{ idx: 0, design, note: "más cerca" }],
        kit,
        episodeTitle: "RAM",
        verdict: "16 GB sí",
        presenter: "Diego",
        productRefs: 1,
      },
    );
    expect(out.briefs).toEqual([
      {
        idx: 0,
        scene: "A man between two laptops",
        textSide: "left",
        lines: ["¿Pagar más", "por RAM?"],
        accent: "RAM?",
      },
    ]);
    const user = (calls[0]!.messages as { content: string }[])[0]!.content;
    expect(user).toContain("Miniatura A (idx 0)");
    expect(user).toContain("Indicación del presentador para esta versión: más cerca");
    expect(String(calls[0]!.system)).toContain("nunca lleva letras");
  });

  it("si falta un brief, usa el texto y la escena del diseño", async () => {
    const { client } = fakeClient({ briefs: [] });
    const out = await thumbnailBriefs(
      client,
      { model: "m" },
      {
        designs: [{ idx: 1, design }],
        kit,
        episodeTitle: "RAM",
        verdict: "",
        presenter: "Diego",
        productRefs: 0,
      },
    );
    expect(out.briefs[0]).toMatchObject({
      idx: 1,
      scene: design.escena,
      lines: ["¿Pagar más", "por RAM?"],
    });
  });

  it("la instrucción para Gemini fija la marca y prohíbe el texto", () => {
    const p = imagePrompt({ scene: "S", textSide: "left", presenterRefs: 3, productRefs: 1, kit });
    expect(p).toContain("The first 3 image(s) are reference photos of the presenter");
    expect(p).toContain("The next 1 image(s) show the real product");
    expect(p).toContain("occupy the right half; keep the left ~45%");
    expect(p).toContain("#E87026");
    expect(p).toMatch(/no text, letters, numbers/);
    expect(
      imagePrompt({ scene: "S", textSide: "right", presenterRefs: 0, productRefs: 0, kit }),
    ).not.toContain("reference photos");
  });
});

describe("calificación", () => {
  it("manda la imagen y devuelve la nota", async () => {
    const score = {
      score: 8,
      criteria: [{ key: "scroll", ok: true, note: "Se entiende" }],
      improve: "Nada",
    };
    const { client, calls } = fakeClient(score);
    const out = await scoreThumbnail(
      client,
      { model: "m" },
      {
        image: Buffer.from("jpg"),
        mime: "image/jpeg",
        design,
        text: { lines: ["¿Pagar más", "por RAM?"], accent: "RAM?" },
        verdict: "16 GB sí",
      },
    );
    expect(out.score).toEqual(score);
    const content = (
      calls[0]!.messages as { content: { type: string; source?: { data: string } }[] }[]
    )[0]!.content;
    expect(content[0]).toMatchObject({
      type: "image",
      source: { data: Buffer.from("jpg").toString("base64") },
    });
  });
});

describe("Gemini", () => {
  const config = geminiConfigFromEnv({ GEMINI_API_KEY: "k", GEMINI_API_URL: "http://mock/" });

  it("lee la configuración del entorno", () => {
    expect(config).toEqual({
      apiKey: "k",
      model: "gemini-3.1-flash-image",
      baseUrl: "http://mock",
      imagePriceUsd: null,
    });
    expect(() => geminiConfigFromEnv({})).toThrow(/GEMINI_API_KEY/);
  });

  it("manda las referencias y la instrucción, y devuelve la imagen", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (u: string, init: RequestInit) => {
      url = u;
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: Buffer.from("png").toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1120 },
        }),
      );
    }) as typeof fetch;
    const out = await generateImage(
      config,
      { prompt: "P", references: [{ mime: "image/jpeg", data: Buffer.from("ref") }] },
      fetchImpl,
    );
    expect(url).toBe("http://mock/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(body).toMatchObject({
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: Buffer.from("ref").toString("base64") } },
            { text: "P" },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
      },
    });
    expect(out.bytes.toString()).toBe("png");
    expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 1120, images: 1 });
  });

  it("avisa si no llega imagen o si Gemini falla", async () => {
    const reply = (json: unknown, status = 200) =>
      (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
    await expect(
      generateImage(
        config,
        { prompt: "P", references: [] },
        reply({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] }),
      ),
    ).rejects.toBeInstanceOf(ImageBlockedError);
    await expect(
      generateImage(
        config,
        { prompt: "P", references: [] },
        reply({ promptFeedback: { blockReason: "OTHER" } }),
      ),
    ).rejects.toBeInstanceOf(ImageBlockedError);
    await expect(
      generateImage(
        config,
        { prompt: "P", references: [] },
        reply({ error: { message: "clave" } }, 403),
      ),
    ).rejects.toThrow(/403: clave/);
  });

  it("calcula el costo por imagen", () => {
    expect(
      imageCostUsd(config, { inputTokens: 2_000_000, outputTokens: 0, images: 1 }),
    ).toBeCloseTo(1.067);
    expect(
      imageCostUsd(
        { model: "gemini-3-pro-image-preview", imagePriceUsd: null },
        { inputTokens: 0, outputTokens: 0, images: 2 },
      ),
    ).toBeCloseTo(0.268);
    expect(
      imageCostUsd(
        { model: "otro", imagePriceUsd: 0.05 },
        { inputTokens: 0, outputTokens: 0, images: 1 },
      ),
    ).toBeCloseTo(0.05);
  });
});
