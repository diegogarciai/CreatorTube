import { describe, expect, it } from "vitest";
import { brandKitSchema, DEFAULT_BRAND_KIT, isMediaPathOf, mediaPath, parseBrandKit } from "../src";

const CH = "3f0c2b8e-1a2b-4c3d-8e9f-001122334455";

describe("kit de marca", () => {
  it("los valores por defecto son válidos y siguen las reglas", () => {
    const { logoPath, ...input } = DEFAULT_BRAND_KIT;
    expect(logoPath).toBeNull();
    expect(brandKitSchema.parse(input)).toEqual(input);
    expect(DEFAULT_BRAND_KIT.colors.accent).toBe("#FF7A29");
    expect(DEFAULT_BRAND_KIT.style.safeZone).toEqual({
      top: 250,
      bottom: 340,
      left: 0,
      right: 120,
    });
  });

  it("valida colores, reparto y curva", () => {
    const base = { ...DEFAULT_BRAND_KIT };
    const bad = (patch: object) => brandKitSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({ colors: { ...base.colors, accent: "naranja" } })).toBe(false);
    expect(bad({ style: { ...base.style, mix: { dark: 70, light: 20, accent: 8 } } })).toBe(false);
    expect(bad({ style: { ...base.style, easing: "ease-in-out" } })).toBe(false);
    const ok = brandKitSchema.parse({ ...base, colors: { ...base.colors, cream: "#f5ecd7" } });
    expect(ok.colors.cream).toBe("#F5ECD7");
  });

  it("lo guardado se completa con los valores por defecto, por partes", () => {
    expect(parseBrandKit(null)).toBe(DEFAULT_BRAND_KIT);
    const kit = parseBrandKit({
      colors: { cream: "#EEE5D0" },
      fonts: { body: 42 },
      style: null,
      thumbnail_style: null,
      logo_path: `${CH}/brand/a.png`,
    });
    expect(kit.colors).toEqual({ ...DEFAULT_BRAND_KIT.colors, cream: "#EEE5D0" });
    // Una parte inválida vuelve completa a los valores por defecto.
    expect(kit.fonts).toEqual(DEFAULT_BRAND_KIT.fonts);
    expect(kit.style).toEqual(DEFAULT_BRAND_KIT.style);
    expect(kit.thumbnailStyle).toBe(DEFAULT_BRAND_KIT.thumbnailStyle);
    expect(kit.logoPath).toBe(`${CH}/brand/a.png`);
  });
});

describe("rutas del bucket", () => {
  it("arma y revisa rutas por canal y carpeta", () => {
    const p = mediaPath(CH, "presenter", "image/jpeg", "abc-123");
    expect(p).toBe(`${CH}/presenter/abc-123.jpg`);
    expect(isMediaPathOf(p, CH, "presenter")).toBe(true);
    expect(isMediaPathOf(p, CH, "brand")).toBe(false);
    expect(isMediaPathOf(`${CH}/presenter/../x.jpg`, CH, "presenter")).toBe(false);
    expect(isMediaPathOf(`otro/presenter/a.jpg`, CH, "presenter")).toBe(false);
    expect(() => mediaPath(CH, "brand", "application/pdf", "x")).toThrow(/invalid_file_type/);
  });
});
