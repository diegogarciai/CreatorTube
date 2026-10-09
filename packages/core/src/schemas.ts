import { z } from "zod";
import { CHECKLIST_PHASES } from "./checklist";
import { EPISODE_STATUSES } from "./episodes";
import { IDEA_ORIGINS, IDEA_SIGNALS, IDEA_STATUSES } from "./ideas";
import { ROLES } from "./permissions";
import { isDateKey, isValidTimeZone } from "./time";

/**
 * Validación de entradas compartida por la API web y la futura app móvil.
 * Los mensajes son claves de traducción (`errors.*`).
 */
const dateKey = z.string().refine(isDateKey, "errors.invalid_date");
const optionalDateKey = z
  .union([dateKey, z.literal(""), z.null()])
  .transform((v) => (v ? v : null));
const timeZone = z.string().refine(isValidTimeZone, "errors.invalid_timezone");
const uuid = z.uuid();
const nonEmpty = (max: number) => z.string().trim().min(1, "errors.required").max(max);

export const FORMATS = ["long", "short", "live", "podcast"] as const;
export type EpisodeFormat = (typeof FORMATS)[number];

export const PRIORITIES = ["low", "normal", "high"] as const;

/** Ficha de entrada (reglas del guionista, sección 3). */
export const EPISODE_TYPES = ["product", "explainer", "news", "opinion"] as const;
export type EpisodeType = (typeof EPISODE_TYPES)[number];
/** Patrocinio: `null` = sin confirmar. */
export const SPONSORSHIPS = ["none", "sponsor", "affiliate"] as const;
export type Sponsorship = (typeof SPONSORSHIPS)[number];
export const TARGET_MINUTES = [5, 8, 10, 12, 14] as const;

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const episodeCreateSchema = z.object({
  channelId: uuid,
  title: nonEmpty(200),
  format: z.enum(FORMATS).default("long"),
  publishDate: optionalDateKey.default(null),
  recordDate: optionalDateKey.default(null),
  pillarId: z
    .union([uuid, z.literal(""), z.null()])
    .transform((v) => v || null)
    .default(null),
  ideaId: uuid.nullable().default(null),
});
export type EpisodeCreateInput = z.infer<typeof episodeCreateSchema>;

export const episodeUpdateSchema = z.object({
  title: nonEmpty(200).optional(),
  format: z.enum(FORMATS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  stance: z.string().trim().max(500).optional(),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  notes: z.string().max(20_000).optional(),
  publishDate: optionalDateKey.optional(),
  recordDate: optionalDateKey.optional(),
  pillarId: z
    .union([uuid, z.literal(""), z.null()])
    .transform((v) => v || null)
    .optional(),
  episodeType: z
    .union([z.enum(EPISODE_TYPES), z.literal(""), z.null()])
    .transform((v) => v || null)
    .optional(),
  targetMinutes: z.coerce.number().int().min(3).max(30).optional(),
  sponsorship: z
    .union([z.enum(SPONSORSHIPS), z.literal(""), z.null()])
    .transform((v) => v || null)
    .optional(),
  ownMeasurements: z.string().max(5000).optional(),
  stanceConfirmed: z.boolean().optional(),
});
export type EpisodeUpdateInput = z.infer<typeof episodeUpdateSchema>;

export const episodeStatusSchema = z.enum(EPISODE_STATUSES);

export const channelProfileSchema = z.object({
  name: nonEmpty(120),
  language: z.string().trim().min(2).max(10),
  timezone: timeZone,
  codePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, "errors.invalid_prefix"),
  hosts: z.array(z.string().trim().min(1).max(80)).max(10),
  audience: z.string().trim().max(1000),
  tone: z.string().trim().max(1000),
  /** Palabras por minuto al leer el guion (duración de los motion graphics). */
  speechWpm: z.number().int().min(100).max(200).optional(),
});
export type ChannelProfileInput = z.infer<typeof channelProfileSchema>;

export const channelRhythmSchema = z.object({
  weeklyGoal: z.coerce.number().int().min(0).max(21),
  publishWeekdays: z.array(z.coerce.number().int().min(1).max(7)).max(7),
  recordWeekdays: z.array(z.coerce.number().int().min(1).max(7)).max(7),
  formats: z.array(z.enum(FORMATS)).min(1),
});
export type ChannelRhythmInput = z.infer<typeof channelRhythmSchema>;

export const pillarSchema = z.object({
  name: nonEmpty(80),
  description: z.string().trim().max(500).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "errors.invalid_color")
    .default("#ea580c"),
});

export const checklistStepSchema = z.object({
  label: nonEmpty(120),
  phase: z.enum(CHECKLIST_PHASES),
});

export const ideaSchema = z.object({
  channelId: uuid,
  title: nonEmpty(200),
  notes: z.string().max(5000).default(""),
  origin: z.enum(IDEA_ORIGINS).default("own"),
  status: z.enum(IDEA_STATUSES).default("new"),
  signals: z.partialRecord(z.enum(IDEA_SIGNALS), z.coerce.number().int().min(1).max(5)).default({}),
});

export const workspaceSchema = z.object({
  name: nonEmpty(80),
});

export const invitationSchema = z.object({
  email: z.email("errors.invalid_email").transform((v) => v.toLowerCase()),
  role: z.enum(ROLES),
  channelIds: z.array(uuid).nullable().default(null),
});

/** Versión nueva de la guía del guionista: el texto se pega tal cual. */
export const writerGuideSchema = z.object({
  content: z.string().trim().min(1, "errors.required").max(300_000),
  notes: z.string().trim().max(1000).default(""),
});
