/**
 * Imágenes con Gemini (Nano Banana) para las miniaturas. La clave y el modelo
 * viven solo en el motor de tareas; GEMINI_API_URL permite apuntar a un mock.
 */

/** Nano Banana Pro: el que mejor mantiene la cara de las fotos de referencia. */
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3-pro-image";

/** Los modelos Pro aceptan 5 personas de referencia y 2K al precio de 1K. */
export const isProImageModel = (model: string) => /-pro-image/.test(model);

/** Cuántas fotos del presentador usa el modelo para mantener la cara. */
export const maxPresenterRefs = (model: string) => (isProImageModel(model) ? 5 : 4);

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Precio por imagen que reemplaza la tabla (US$), si se define en el entorno. */
  imagePriceUsd: number | null;
}

export function geminiConfigFromEnv(env: Record<string, string | undefined>): GeminiConfig {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY en el motor de tareas");
  const price = Number(env.GEMINI_IMAGE_PRICE_USD);
  return {
    apiKey,
    model: env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL,
    baseUrl: (env.GEMINI_API_URL?.trim() || "https://generativelanguage.googleapis.com").replace(
      /\/+$/,
      "",
    ),
    imagePriceUsd: Number.isFinite(price) && price > 0 ? price : null,
  };
}

/** Una imagen de referencia con su etiqueta, que va en texto justo antes. */
export type ImageInput = { mime: string; data: Buffer; label: string };

export type ImageUsage = { inputTokens: number; outputTokens: number; images: number };

export class ImageBlockedError extends Error {
  constructor(readonly reason: string | null) {
    super("errors.image_blocked");
  }
}

type GeminiResponse = {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

/**
 * Una imagen 16:9 a partir del texto y las imágenes de referencia: cada
 * referencia va precedida de su etiqueta y la instrucción va al final.
 */
export async function generateImage(
  config: GeminiConfig,
  input: { prompt: string; references: ImageInput[] },
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; mime: string; usage: ImageUsage }> {
  const res = await fetchImpl(
    `${config.baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              ...input.references.flatMap((r) => [
                { text: r.label },
                { inlineData: { mimeType: r.mime, data: r.data.toString("base64") } },
              ]),
              { text: input.prompt },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: isProImageModel(config.model) ? "2K" : "1K",
          },
        },
      }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    throw new Error(`Gemini respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  }
  if (json.promptFeedback?.blockReason)
    throw new ImageBlockedError(json.promptFeedback.blockReason);
  const candidate = json.candidates?.[0];
  const image = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!image?.data) throw new ImageBlockedError(candidate?.finishReason ?? null);
  return {
    bytes: Buffer.from(image.data, "base64"),
    mime: image.mimeType ?? "image/png",
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      images: 1,
    },
  };
}

/** Precios de lista (US$): entrada por millón de tokens y salida por imagen (1K, o 2K en Pro). */
const IMAGE_PRICES: Record<string, { inputPerMTok: number; perImage: number }> = {
  "gemini-3.1-flash-image": { inputPerMTok: 0.5, perImage: 0.067 },
  "gemini-3-pro-image": { inputPerMTok: 2, perImage: 0.134 },
  "gemini-3.1-flash-lite-image": { inputPerMTok: 0.25, perImage: 0.034 },
};

/** Lo que costó una imagen; un modelo desconocido se cobra como el por defecto. */
export function imageCostUsd(
  config: Pick<GeminiConfig, "model" | "imagePriceUsd">,
  usage: ImageUsage,
) {
  const key = config.model.replace(/-preview$/, "");
  const p = IMAGE_PRICES[key] ?? IMAGE_PRICES[DEFAULT_GEMINI_IMAGE_MODEL]!;
  const perImage = config.imagePriceUsd ?? p.perImage;
  return (usage.inputTokens * p.inputPerMTok) / 1_000_000 + usage.images * perImage;
}
