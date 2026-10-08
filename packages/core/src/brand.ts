import { z } from "zod";

/**
 * Kit de marca del canal: lo usan las miniaturas (Fase 3 · paso 2) y las
 * piezas animadas (paso 4). Los valores por defecto salen de las reglas del
 * guionista v4.1 (manual de identidad Gartechs v3.0); los que las reglas no
 * dicen con exactitud se ajustan con el manual desde Ajustes.
 */

export const BRAND_COLOR_ROLES = [
  "canvas",
  "text",
  "cream",
  "accent",
  "amber",
  "amberDeep",
] as const;
export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];

export const BRAND_FONT_ROLES = ["body", "display", "mono"] as const;
export type BrandFontRole = (typeof BRAND_FONT_ROLES)[number];

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "errors.invalid_color")
  .transform((v) => v.toUpperCase());
const font = z.string().trim().min(1).max(60);
const percent = z.coerce.number().min(0).max(100);
const px = z.coerce.number().int().min(0).max(1920);

export const brandColorsSchema = z.object({
  /** Fondo lienzo (negro de la marca). */
  canvas: hex,
  /** Texto principal. */
  text: hex,
  /** Texto secundario y definiciones. */
  cream: hex,
  /** Naranja: lo que importa y la conclusión. */
  accent: hex,
  /** Ámbar: el bloque protagonista. */
  amber: hex,
  /** Ámbar profundo: botones y enlaces del boletín. */
  amberDeep: hex,
});

export const brandFontsSchema = z.object({
  /** Textos. */
  body: font,
  /** Titulares y texto de las miniaturas. */
  display: font,
  /** Cifras y etiquetas. */
  mono: font,
});

export const brandStyleSchema = z.object({
  /** Reparto de color en pantalla: negro, blanco y crema, naranja (suman 100). */
  mix: z
    .object({ dark: percent, light: percent, accent: percent })
    .refine((m) => Math.round(m.dark + m.light + m.accent) === 100, "errors.brand_mix"),
  /** Retícula del fondo: opacidad normal y con datos en pantalla. */
  grid: z.object({
    size: z.coerce.number().int().min(8).max(400),
    opacity: percent,
    dataOpacity: percent,
  }),
  /** Halo del fondo; se apaga cuando hay datos en pantalla. */
  halo: z.object({ enabled: z.boolean(), offWithData: z.boolean() }),
  /** Curva de movimiento de la marca (CSS `cubic-bezier`). */
  easing: z
    .string()
    .trim()
    .regex(
      /^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$/,
      "errors.invalid_easing",
    ),
  /** Texto blanco sobre naranja solo desde este tamaño (px). */
  minWhiteOnAccentPx: z.coerce.number().int().min(8).max(400),
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
    canvas: "#0A0A0A",
    text: "#FFFFFF",
    cream: "#F2E8D5",
    accent: "#FF7A29",
    amber: "#F5A524",
    amberDeep: "#C65014",
  },
  fonts: { body: "Inter", display: "Inter Display Black", mono: "JetBrains Mono" },
  style: {
    mix: { dark: 70, light: 22, accent: 8 },
    grid: { size: 48, opacity: 10, dataOpacity: 6 },
    halo: { enabled: true, offWithData: true },
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    minWhiteOnAccentPx: 64,
    safeZone: { top: 250, bottom: 340, left: 0, right: 120 },
  },
  thumbnailStyle:
    "Texto de 2 a 4 palabras en dos líneas, en blanco con una sola palabra en naranja; nunca amarillo. " +
    "El presentador de frente o en tres cuartos, bien iluminado y sin nada que le tape la cara; " +
    "el producto real, grande e idéntico al modelo.",
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
