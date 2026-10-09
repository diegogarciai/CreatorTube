import { z } from "zod";
import { diffDays, isDateKey, type DateKey } from "./time";

/**
 * «Mi equipo»: los dispositivos del canal (propios o de marcas). Alimentan las
 * ideas de episodios y, después, los episodios y su descripción.
 */

export const GEAR_CATEGORIES = [
  "drone",
  "laptop",
  "computer",
  "phone",
  "tablet",
  "camera",
  "audio",
  "lighting",
  "wearable",
  "gaming",
  "smart_home",
  "accessory",
  "other",
] as const;
export type GearCategory = (typeof GEAR_CATEGORIES)[number];

/** own: propio · loan: prestado por una marca · gift: regalado · sponsored: patrocinado. */
export const GEAR_OWNERSHIP = ["own", "loan", "gift", "sponsored"] as const;
export type GearOwnership = (typeof GEAR_OWNERSHIP)[number];

/** review: lo ordenó Claude desde una lista pegada y espera confirmación. */
export const GEAR_STATUSES = ["active", "retired", "returned", "review"] as const;
export type GearStatus = (typeof GEAR_STATUSES)[number];

/** Lo que vino de una marca: el guion debe aclararlo (regla de YouTube). */
export const fromBrand = (ownership: GearOwnership) => ownership !== "own";

/** Cómo se nombra el equipo: marca y modelo si los hay; si no, su nombre. */
export function gearLabel(g: { name: string; brand: string; model: string }) {
  const bm = [g.brand.trim(), g.model.trim()].filter(Boolean).join(" ");
  return bm || g.name.trim();
}

/** Meses completos desde que se tiene (null si no se sabe). */
export function gearAgeMonths(acquiredOn: DateKey | null, today: DateKey): number | null {
  if (!acquiredOn) return null;
  const [y1, m1, d1] = acquiredOn.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split("-").map(Number) as [number, number, number];
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, months);
}

/** Con cuántos días de anticipación se avisa de un préstamo por devolver. */
export const LOAN_WARN_DAYS = 10;

/** Días que faltan para devolver un préstamo (negativo si ya pasó; null si no aplica). */
export function loanDaysLeft(
  g: { ownership: GearOwnership; return_by: DateKey | null; status: GearStatus },
  today: DateKey,
): number | null {
  if (g.ownership !== "loan" || !g.return_by || g.status !== "active") return null;
  return diffDays(today, g.return_by);
}

const optionalDate = z.union([z.literal(""), z.string().refine(isDateKey, "Fecha inválida")]);

export const gearSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    brand: z.string().trim().max(80).optional(),
    model: z.string().trim().max(120).optional(),
    category: z.enum(GEAR_CATEGORIES).optional(),
    ownership: z.enum(GEAR_OWNERSHIP).optional(),
    acquiredOn: optionalDate.optional(),
    returnBy: optionalDate.optional(),
    notes: z.string().trim().max(2000).optional(),
    affiliateUrl: z.union([z.literal(""), z.url().max(500)]).optional(),
  })
  .transform((g) => {
    const ownership = g.ownership ?? "own";
    return {
      name: g.name,
      brand: g.brand ?? "",
      model: g.model ?? "",
      category: g.category ?? "other",
      ownership,
      acquiredOn: g.acquiredOn || null,
      // La fecha de devolución es solo de los préstamos.
      returnBy: ownership === "loan" ? g.returnBy || null : null,
      notes: g.notes ?? "",
      affiliateUrl: g.affiliateUrl || null,
    };
  });
export type GearInput = z.input<typeof gearSchema>;
export type GearData = z.output<typeof gearSchema>;
