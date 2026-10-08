import { z } from "zod";

/**
 * Kit de marca del canal: lo usan las miniaturas (Fase 3 · paso 2) y las
 * piezas animadas (paso 4). Los valores por defecto son los del manual de
 * identidad Gartechs v3.0; cada canal los ajusta desde Ajustes.
 */

export const BRAND_COLOR_ROLES = [
  "canvas",
  "page",
  "text",
  "cream",
  "accent",
  "glow",
  "amberDeep",
  "grid",
] as const;
export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];

export const BRAND_FONT_ROLES = ["body", "display", "thumbnail", "mono"] as const;
export type BrandFontRole = (typeof BRAND_FONT_ROLES)[number];

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "errors.invalid_color")
  .transform((v) => v.toUpperCase());
const font = z.string().trim().min(1).max(60);
const percent = z.coerce.number().min(0).max(100);
const px = z.coerce.number().int().min(0).max(1920);
const textPx = z.coerce.number().int().min(8).max(400);

export const brandColorsSchema = z.object({
  /** Fondo lienzo: base de toda la comunicación. */
  canvas: hex,
  /** Negro página: viñeteado y bordes. */
  page: hex,
  /** Blanco titular: máximo contraste. */
  text: hex,
  /** Crema cálido: antetítulos, filetes y datos secundarios. */
  cream: hex,
  /** Naranja marca: el punto, titulares clave, CTA y la conclusión. */
  accent: hex,
  /** Naranja resplandor: centro del halo. */
  glow: hex,
  /** Ámbar profundo: caída del halo, secciones y botones. */
  amberDeep: hex,
  /** Naranja retícula: la cuadrícula del fondo. */
  grid: hex,
});

export const brandFontsSchema = z.object({
  /** Texto de lectura. */
  body: font,
  /** Titulares. */
  display: font,
  /** Texto de las miniaturas. */
  thumbnail: font,
  /** Cifras, especificaciones y etiquetas. */
  mono: font,
});

export const brandStyleSchema = z.object({
  /** Reparto de color en pantalla: negro, blanco y crema, naranja (suman 100). */
  mix: z
    .object({ dark: percent, light: percent, accent: percent })
    .refine((m) => Math.round(m.dark + m.light + m.accent) === 100, "errors.brand_mix"),
  /** Retícula del fondo: celda, opacidad normal y con datos en pantalla. */
  grid: z.object({
    size: z.coerce.number().int().min(8).max(400),
    opacity: percent,
    dataOpacity: percent,
  }),
  /** Halo radial: resplandor al centro y ámbar profundo en la caída (opacidades). */
  halo: z.object({
    enabled: z.boolean(),
    offWithData: z.boolean(),
    center: percent,
    edge: percent,
  }),
  /** Curva de movimiento de la marca (CSS `cubic-bezier`). */
  easing: z
    .string()
    .trim()
    .regex(
      /^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$/,
      "errors.invalid_easing",
    ),
  /** Texto blanco sobre naranja solo desde este tamaño (px). */
  minWhiteOnAccentPx: textPx,
  /** Texto sobre el halo solo desde este tamaño (px). */
  minTextOnHaloPx: textPx,
  /** Zona segura del vertical 1080 × 1920 (px libres en cada borde). */
  safeZone: z.object({ top: px, bottom: px, left: px, right: px }),
});

export const brandKitSchema = z.object({
  colors: brandColorsSchema,
  fonts: brandFontsSchema,
  style: brandStyleSchema,
  /** Indicaciones de estilo para las miniaturas, en texto libre. */
  thumbnailStyle: z.string().trim().max(2000),
});

export type BrandColors = z.infer<typeof brandColorsSchema>;
export type BrandFonts = z.infer<typeof brandFontsSchema>;
export type BrandStyle = z.infer<typeof brandStyleSchema>;
export type BrandKitInput = z.infer<typeof brandKitSchema>;
export type BrandKit = BrandKitInput & { logoPath: string | null };

export const DEFAULT_BRAND_KIT: BrandKit = {
  colors: {
    canvas: "#111213",
    page: "#0E0F10",
    text: "#FFFFFF",
    cream: "#FFD9BD",
    accent: "#FF7A29",
    glow: "#E87026",
    amberDeep: "#C65014",
    grid: "#E2661F",
  },
  fonts: {
    body: "Inter",
    display: "Inter Display",
    thumbnail: "Inter Display Black",
    mono: "JetBrains Mono",
  },
  style: {
    mix: { dark: 70, light: 22, accent: 8 },
    grid: { size: 80, opacity: 10, dataOpacity: 6 },
    halo: { enabled: true, offWithData: true, center: 55, edge: 28 },
    easing: "cubic-bezier(0.2, 0, 0, 1)",
    minWhiteOnAccentPx: 64,
    minTextOnHaloPx: 48,
    safeZone: { top: 250, bottom: 340, left: 0, right: 120 },
  },
  thumbnailStyle: [
    "Tres miniaturas, una promesa: A la pregunta, B el dato (solo si está verificado), C el veredicto con postura.",
    "Texto de 2 a 4 palabras en dos líneas, casi la mitad del ancho, en blanco con una sola palabra clave en naranja; nunca amarillo.",
    "Fondo oscuro y luz cálida con halo naranja. Sin flechas, emojis, marcos ni logos inventados.",
    "El presentador con expresión natural, nunca cara de asombro; de medio cuerpo al menos en el veredicto.",
    "Sombra suave y negra solo para que se lea el texto. Baldosa G. como marca de agua. 1280 × 720 y menos de 2 MB.",
  ].join(" "),
  logoPath: null,
};

/** Lo guardado en `brand_kits` (por partes) sobre los valores por defecto. */
export function parseBrandKit(
  row: {
    colors?: unknown;
    fonts?: unknown;
    style?: unknown;
    thumbnail_style?: string | null;
    logo_path?: string | null;
  } | null,
): BrandKit {
  const d = DEFAULT_BRAND_KIT;
  if (!row) return d;
  const part = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const merged =
      value && typeof value === "object" && !Array.isArray(value)
        ? { ...fallback, ...(value as object) }
        : fallback;
    const r = schema.safeParse(merged);
    return r.success ? r.data : fallback;
  };
  return {
    colors: part(brandColorsSchema, row.colors, d.colors),
    fonts: part(brandFontsSchema, row.fonts, d.fonts),
    style: part(brandStyleSchema, row.style, d.style),
    thumbnailStyle: row.thumbnail_style ?? d.thumbnailStyle,
    logoPath: row.logo_path ?? null,
  };
}

/** Archivos que acepta el bucket `channel-media` (igual que la migración). */
export const MEDIA_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const PRESENTER_PHOTOS_MAX = 8;

const EXT: Record<(typeof MEDIA_MIME_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export type MediaFolder = "brand" | "presenter";

/** Ruta nueva en el bucket: `{canal}/{carpeta}/{id}.{ext}`. */
export function mediaPath(channelId: string, folder: MediaFolder, mime: string, id: string) {
  const ext = EXT[mime as keyof typeof EXT];
  if (!ext) throw new Error("errors.invalid_file_type");
  return `${channelId}/${folder}/${id}.${ext}`;
}

/** ¿La ruta es de ese canal y esa carpeta? (lo revisa también la base). */
export function isMediaPathOf(path: string, channelId: string, folder: MediaFolder) {
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    parts[0] === channelId &&
    parts[1] === folder &&
    /^[\w-]+\.(png|jpg|webp|svg)$/.test(parts[2]!)
  );
}
