import { describe, expect, it } from "vitest";
import {
  findAccent,
  generateImage,
  geminiConfigFromEnv,
  ImageBlockedError,
  imageCostUsd,
  maxPresenterRefs,
  locateSubjects,
  schemeImagePrompt,
  SCORE_CRITERIA,
  thumbnailIdeas,
  scoreThumbnail,
  thumbnailBriefs,
} from "../src";

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const kit = {
  canvas: "#111213",
  glow: "#E87026",
  amberDeep: "#C65014",
  accent: "#FF7A29",
  cream: "#FFD9BD",
  grid: "#E2661F",
  thumbnailStyle: "Guía de miniaturas v1.0",
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

describe("palabra naranja", () => {
  it("la toma tal como está en el texto", () => {
    expect(findAccent("¿Vale la pena?", "PENA")).toBe("pena?");
    expect(findAccent("40% más barato", "40%")).toBe("40%");
    expect(findAccent("Sí lo compro", "amarillo")).toBe("compro");
  });
});

const item = {
  idx: 0,
  scheme: "C" as const,
  scenario: "en la mano" as const,
  text: "No lo compres",
  accent: "compres",
  angle: "El veredicto",
  emotion: "alivio",
  idea: "Diego sostiene el portátil",
};

describe("brief de las miniaturas", () => {
  it("pide la escena de cada esquema en una sola llamada", async () => {
    const { client, calls } = fakeClient({
      briefs: [
        { idx: 0, scene: "Diego holds the laptop", mirror: true },
        { idx: 1, scene: "The laptop alone", mirror: true },
      ],
    });
    const out = await thumbnailBriefs(
      client,
      { model: "m" },
      {
        items: [
          { ...item, note: "más cerca" },
          { ...item, idx: 1, scheme: "B", scenario: "set oscuro", text: "40% más barato" },
        ],
        kit,
        episodeTitle: "RAM",
        verdict: "No compres 8 GB",
        presenter: "Diego",
        productRefs: ["portátil gris"],
      },
    );
    // El espejo solo vale en A y C.
    expect(out.briefs).toEqual([
      { idx: 0, scene: "Diego holds the laptop", mirror: true },
      { idx: 1, scene: "The laptop alone", mirror: false },
    ]);
    const user = (calls[0]!.messages as { content: string }[])[0]!.content;
    expect(user).toContain("Miniatura A (idx 0)");
    expect(user).toContain("esquema: C · El veredicto");
    expect(user).toContain("escenario: en la mano");
    expect(user).toContain("Product photo 1: portátil gris");
    expect(user).toContain("Indicación del presentador para esta versión: más cerca");
    const system = String(calls[0]!.system);
    expect(system).toContain("nunca lleva letras");
    expect(system).toContain("Nunca asombro, boca abierta, señalar");
  });

  it("si falta un brief, usa la escena de la lista", async () => {
    const { client } = fakeClient({ briefs: [] });
    const out = await thumbnailBriefs(
      client,
      { model: "m" },
      { items: [item], kit, episodeTitle: "RAM", verdict: "", presenter: "Diego", productRefs: [] },
    );
    expect(out.briefs[0]).toEqual({ idx: 0, scene: item.idea, mirror: false });
  });
});

describe("prompt por esquema (guía v1.0)", () => {
  const base = {
    scene: "S",
    scenario: "set oscuro" as const,
    presenterRefs: 3,
    productRefs: 2,
    kit,
  };

  it("todos llevan el prompt base y dejan libre la zona del texto y la esquina", () => {
    for (const scheme of ["A", "B", "C", "D", "E", "F"] as const) {
      const p = schemeImagePrompt({ ...base, scheme });
      expect(p).toContain("16:9, 1280×720");
      expect(p).toContain("#E87026");
      expect(p).toContain("#C65014");
      expect(p).toContain("#FFD9BD");
      expect(p).toContain("vignette to black");
      expect(p).toContain("64 px safe margin");
      expect(p).toContain("bottom-right corner (220×90 px) stays empty");
      expect(p).toMatch(/no text, letters, numbers/);
      expect(p).toContain("No blue, neon, RGB, yellow, wood or gold");
      expect(p).toContain("Scene: S");
    }
  });

  it("cada esquema pone a cada uno donde manda la guía", () => {
    const a = schemeImagePrompt({ ...base, scheme: "A" });
    expect(a).toContain("On the right (40% of the width), the presenter from the waist up");
    expect(a).toContain("hand on the chin");
    expect(a).toContain("The left 50% of the frame stays as empty");
    expect(schemeImagePrompt({ ...base, scheme: "A", mirror: true })).toContain(
      "On the left (40% of the width)",
    );
    const b = schemeImagePrompt({ ...base, scheme: "B" });
    expect(b).toContain("No people at all");
    expect(b).toContain("rotated 5–10°");
    // Sin cara, sin fotos del presentador.
    expect(b).not.toContain("Reference photo of the presenter");
    const c = schemeImagePrompt({ ...base, scheme: "C" });
    expect(c).toContain("On the left (45% of the width)");
    expect(c).toContain("holding the real product toward the camera");
    const d = schemeImagePrompt({ ...base, scheme: "D" });
    expect(d).toContain("Real product 1 (Product photo 1) on the left");
    expect(d).toContain("presenter small (about 25% of the width)");
    expect(d).toContain("No dividing lines");
    expect(schemeImagePrompt({ ...base, scheme: "E" })).toContain("upper-right two thirds");
    const f = schemeImagePrompt({ ...base, scheme: "F", scenario: "café" });
    expect(f).toContain("without the grid");
    expect(f).toContain("in a café table");
    expect(f).toContain("not looking at the camera");
    expect(f).not.toContain("faint orange grid");
    expect(a).toContain("faint orange grid");
  });

  it("las referencias del presentador solo en los esquemas con cara", () => {
    expect(schemeImagePrompt({ ...base, scheme: "A" })).toContain(
      'The 3 images labeled "Reference photo of the presenter" all show the same real person',
    );
    expect(schemeImagePrompt({ ...base, scheme: "E" })).not.toContain("Reference photo");
    expect(schemeImagePrompt({ ...base, scheme: "B", productRefs: 1 })).toContain(
      'The images labeled "Product photo" show the real product',
    );
  });
});

describe("calificación", () => {
  const input = {
    image: Buffer.from("jpg"),
    mobile: Buffer.from("mini"),
    mime: "image/jpeg",
    scheme: "A" as const,
    text: { lines: ["¿Vale la", "pena?"], accent: "pena?" },
    topic: "¿Vale la pena 16 GB?",
    titles: ["16 GB de RAM en 2026"],
    verdict: "16 GB sí",
    warnings: [],
    reference: { data: Buffer.from("cara"), mime: "image/jpeg" },
  };

  it("manda la miniatura, la prueba de móvil y la referencia, con los criterios de la guía", async () => {
    const score = {
      score: 8,
      criteria: [{ key: "mobile", ok: true, note: "Se lee" }],
      improve: "Nada",
    };
    const { client, calls } = fakeClient(score);
    const out = await scoreThumbnail(client, { model: "m" }, input);
    expect(out.score).toEqual(score);
    const content = (
      calls[0]!.messages as {
        content: { type: string; text?: string; source?: { data: string } }[];
      }[]
    )[0]!.content;
    expect(content[0]).toMatchObject({ source: { data: Buffer.from("jpg").toString("base64") } });
    expect(content[1]).toMatchObject({
      text: "La misma miniatura a 168 × 94 px (prueba de móvil):",
    });
    expect(content[2]).toMatchObject({ source: { data: Buffer.from("mini").toString("base64") } });
    expect(content[3]).toMatchObject({ text: "Foto de referencia del presentador:" });
    const facts = String(content[5]!.text);
    expect(facts).toContain("Esquema: A · La pregunta");
    expect(facts).toContain("Reglas de texto medibles: cumple.");
    expect(facts).toContain("Medido por la app: el texto deja 40 px");
    expect(facts).toContain("Títulos del video: 16 GB de RAM en 2026");
    const system = String(calls[0]!.system);
    for (const key of SCORE_CRITERIA) expect(system).toContain(`- ${key}:`);
  });

  it("pasa los avisos de la app y lo que el texto no cumple; sin cara, sin referencia", async () => {
    const { client, calls } = fakeClient({ score: 5, criteria: [], improve: "x" });
    await scoreThumbnail(
      client,
      { model: "m" },
      {
        ...input,
        scheme: "B",
        text: { lines: ["Mucho más", "barato"], accent: "barato" },
        warnings: ["El texto queda a menos de 40 px de la cara."],
      },
    );
    const content = (calls[0]!.messages as { content: { type: string; text?: string }[] }[])[0]!
      .content;
    expect(content.some((c) => c.text === "Foto de referencia del presentador:")).toBe(false);
    const facts = String(content.at(-1)!.text);
    expect(facts).toContain("Reglas de texto que no cumple: El dato empieza con una cifra");
    expect(facts).toContain("Medido por la app: El texto queda a menos de 40 px de la cara.");
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
  const input = {
    episodeTitle: "¿Vale la pena 16 GB?",
    verdict: "16 GB para trabajar",
    sheet: "Ficha con cifras: 23 % más.",
    titles: ["16 GB de RAM en 2026"],
    keywords: ["16 gb ram"],
    thumbnailStyle: "Guía v1.0",
    presenter: "Diego",
    schemes: ["A", "B", "C"] as ("A" | "B" | "C")[],
    recommended: ["A", "B", "C"] as ("A" | "B" | "C")[],
  };

  it("pide 30 textos con su esquema y descarta los que no cumplen la guía", async () => {
    const idea = (scheme: string, text: string, accent: string) => ({
      scheme,
      angle: "El dinero",
      text,
      accent,
      scene: "s",
      emotion: "e",
    });
    const { client, calls } = fakeClient({
      ideas: [
        idea("A", "¿Vale  la pena?", "PENA"),
        idea("A", "¿vale la pena?", "pena"), // repetido
        idea("A", "¿VALE LA PENA EN 2026 O NO?", "pena"), // mayúsculas y largo
        idea("B", "40% más barato", "40%"),
        idea("B", "Mucho más barato", "barato"), // sin dato
        idea("C", "No lo compres", "compres"),
        idea("C", "¿No lo compres?", "compres"), // C sin pregunta
        idea("D", "¿Cuál gana?", "gana"), // esquema no disponible
      ],
    });
    const out = await thumbnailIdeas(client, { model: "m" }, input);
    expect(out.ideas.map((i) => [i.scheme, i.text, i.accent])).toEqual([
      ["A", "¿Vale la pena?", "pena?"],
      ["B", "40% más barato", "40%"],
      ["C", "No lo compres", "compres"],
    ]);
    const user = (calls[0]!.messages as { content: string }[])[0]!.content;
    expect(user).toContain("Tema central del episodio: ¿Vale la pena 16 GB?");
    expect(user).toContain("Ficha con cifras: 23 % más.");
    expect(user).toContain("Veredicto («el punto»): 16 GB para trabajar");
    const system = String(calls[0]!.system);
    expect(system).toContain("- A · La pregunta.");
    expect(system).toContain("- C · El veredicto.");
    expect(system).not.toContain("- D · El duelo.");
    expect(system).toContain(
      "al menos 3 por esquema, y más en el set recomendado para este episodio (A+B+C)",
    );
    expect(system).toContain("Las cifras solo pueden salir de la ficha");
    expect(system).toContain("El texto completa el título, no lo repite");
  });
});
