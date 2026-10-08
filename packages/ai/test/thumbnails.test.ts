import { describe, expect, it } from "vitest";
import {
  generateImage,
  geminiConfigFromEnv,
  ImageBlockedError,
  imageCostUsd,
  maxPresenterRefs,
  imagePrompt,
  locateSubjects,
  thumbnailIdeas,
  designFromIdea,
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
  angulo: "El dinero",
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
    expect(user).toContain("ángulo: El dinero");
    expect(user).toContain("Tema central del episodio: RAM");
    expect(String(calls[0]!.system)).toContain("tres ángulos totalmente distintos");
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
    expect(p).toContain(
      'The 3 images labeled "Reference photo of the presenter" all show the same real person',
    );
    expect(p).toContain('The images labeled "Product photo" show the real product');
    // La cara grande también cuando el producto manda: una cara chica sale como otra persona.
    expect(p).toContain("even when the product is the main subject");
    expect(p).toContain("occupy the right half; keep the left ~45%");
    expect(p).toContain("#E87026");
    expect(p).toMatch(/no text, letters, numbers/);
    expect(
      imagePrompt({ scene: "S", textSide: "right", presenterRefs: 0, productRefs: 0, kit }),
    ).not.toContain("Reference photo");
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
        topic: "¿Vale la pena 16 GB?",
        verdict: "16 GB sí",
        reference: { data: Buffer.from("cara"), mime: "image/jpeg" },
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
    // Después de la miniatura va la foto de referencia, para comparar la cara.
    expect(content[1]).toMatchObject({ type: "text", text: "Foto de referencia del presentador:" });
    expect(content[2]).toMatchObject({
      type: "image",
      source: { data: Buffer.from("cara").toString("base64") },
    });
    expect(JSON.stringify(content[3])).toContain("Ángulo de esta miniatura: El dinero");
    expect(JSON.stringify(content[3])).toContain("Tema central del episodio: ¿Vale la pena 16 GB?");
    expect(String(calls[0]!.system)).toContain("misma persona de la foto de referencia");
    expect(String(calls[0]!.system)).toContain("- angle:");
  });
});

describe("Gemini", () => {
  const config = geminiConfigFromEnv({ GEMINI_API_KEY: "k", GEMINI_API_URL: "http://mock/" });

  it("lee la configuración del entorno", () => {
    expect(config).toEqual({
      apiKey: "k",
      model: "gemini-3-pro-image",
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
      {
        prompt: "P",
        references: [{ mime: "image/jpeg", data: Buffer.from("ref"), label: "Reference photo 1:" }],
      },
      fetchImpl,
    );
    expect(url).toBe("http://mock/v1beta/models/gemini-3-pro-image:generateContent");
    expect(body).toMatchObject({
      contents: [
        {
          parts: [
            { text: "Reference photo 1:" },
            { inlineData: { mimeType: "image/jpeg", data: Buffer.from("ref").toString("base64") } },
            { text: "P" },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
      },
    });
    // Con Nano Banana 2 se pide 1K (2K cuesta más ahí).
    await generateImage(
      { ...config, model: "gemini-3.1-flash-image" },
      { prompt: "P", references: [] },
      fetchImpl,
    );
    expect(body).toMatchObject({ generationConfig: { imageConfig: { imageSize: "1K" } } });
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
      imageCostUsd(config, { inputTokens: 1_000_000, outputTokens: 0, images: 1 }),
    ).toBeCloseTo(2.134);
    expect(
      imageCostUsd(
        { model: "gemini-3.1-flash-image", imagePriceUsd: null },
        { inputTokens: 2_000_000, outputTokens: 0, images: 1 },
      ),
    ).toBeCloseTo(1.067);
    expect([
      maxPresenterRefs("gemini-3-pro-image"),
      maxPresenterRefs("gemini-3.1-flash-image"),
    ]).toEqual([5, 4]);
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

describe("ubicar la cara y el producto", () => {
  it("devuelve recuadros dentro de la imagen", async () => {
    const { client, calls } = fakeClient({
      boxes: [
        { label: "face", x: 0.7, y: 0.1, w: 0.2, h: 0.4 },
        { label: "product", x: 0.9, y: 0.8, w: 0.5, h: 0.5 },
        { label: "person", x: -0.2, y: 0.5, w: 0, h: 0.3 },
      ],
    });
    const out = await locateSubjects(
      client,
      { model: "m" },
      { image: Buffer.from("jpg"), mime: "image/jpeg" },
    );
    expect(out.boxes).toEqual([
      { label: "face", x: 0.7, y: 0.1, w: 0.2, h: 0.4 },
      { label: "product", x: 0.9, y: 0.8, w: expect.closeTo(0.1), h: expect.closeTo(0.2) },
    ]);
    expect(String(calls[0]!.system)).toContain("para que un titular no los tape");
  });
});

describe("textos para miniaturas", () => {
  it("pide 30 textos de ángulos distintos con la ficha y limpia la salida", async () => {
    const { client, calls } = fakeClient({
      ideas: [
        {
          angle: "El dinero",
          text: "¿Pagar  más por RAM?",
          accent: "ram",
          scene: "s",
          emotion: "pagar de más",
        },
        {
          angle: "El dinero",
          text: "¿pagar más por ram?",
          accent: "RAM",
          scene: "s",
          emotion: "x",
        },
        {
          angle: "El mito",
          text: "8 GB alcanzan",
          accent: "nada",
          scene: "s2",
          emotion: "sorpresa",
        },
      ],
    });
    const out = await thumbnailIdeas(
      client,
      { model: "m" },
      {
        episodeTitle: "¿Vale la pena 16 GB?",
        verdict: "16 GB para trabajar",
        sheet: "Ficha con cifras: 23 % más.",
        titles: ["No compres 8 GB"],
        keywords: ["16 gb ram"],
        thumbnailStyle: "Tres ángulos",
        presenter: "Diego",
      },
    );
    expect(out.ideas).toEqual([
      {
        angle: "El dinero",
        text: "¿Pagar más por RAM?",
        accent: "RAM?",
        scene: "s",
        emotion: "pagar de más",
      },
      {
        angle: "El mito",
        text: "8 GB alcanzan",
        accent: "alcanzan",
        scene: "s2",
        emotion: "sorpresa",
      },
    ]);
    const user = (calls[0]!.messages as { content: string }[])[0]!.content;
    expect(user).toContain("Tema central del episodio: ¿Vale la pena 16 GB?");
    expect(user).toContain("Ficha con cifras: 23 % más.");
    expect(String(calls[0]!.system)).toContain("al menos 8 ángulos");
    expect(String(calls[0]!.system)).toContain("Las cifras solo pueden salir de la ficha");
  });

  it("un texto elegido sirve como diseño de miniatura", () => {
    expect(
      designFromIdea({
        angle: "El error",
        text: "No compres 8 GB",
        accent: "GB",
        scene: "e",
        emotion: "miedo",
      }),
    ).toMatchObject({
      angulo: "El error",
      texto: "No compres 8 GB",
      escena: "e",
      emocion: "miedo",
    });
  });
});
