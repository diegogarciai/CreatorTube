import { addDays, diffDays, type DateKey } from "./time";
import { can, type Role } from "./permissions";

/**
 * Flujo de 6 estados del panel. Los dos últimos avanzan solos leyendo YouTube.
 * Las etiquetas visibles viven en `apps/web/messages/es.json` (`status.*`).
 */
export const EPISODE_STATUSES = [
  "planned",
  "script",
  "to_record",
  "editing",
  "scheduled",
  "published",
] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

/**
 * Etapas de la página del episodio. Cada una tiene un solo botón principal.
 * `planning` es la etapa previa a la dirección: el episodio existe pero aún
 * no se empieza.
 */
export const EPISODE_STAGES = [
  "planning",
  "direction",
  "script",
  "verification",
  "preparation",
  "recording",
  "publication",
  "distribution",
  "evaluation",
] as const;
export type EpisodeStage = (typeof EPISODE_STAGES)[number];

/** Estado del episodio mientras está en cada etapa. */
const STATUS_DURING: Record<EpisodeStage, EpisodeStatus> = {
  planning: "planned",
  direction: "script",
  script: "script",
  verification: "script",
  preparation: "to_record",
  recording: "to_record",
  publication: "editing",
  distribution: "published",
  evaluation: "published",
};

/** Etapa en la que cae un episodio cuando se cambia su estado a mano (tablero, calendario). */
const DEFAULT_STAGE: Record<EpisodeStatus, EpisodeStage> = {
  planned: "planning",
  script: "direction",
  to_record: "preparation",
  editing: "publication",
  scheduled: "publication",
  published: "distribution",
};

export function statusDuringStage(stage: EpisodeStage): EpisodeStatus {
  return STATUS_DURING[stage];
}

export function defaultStageFor(status: EpisodeStatus): EpisodeStage {
  return DEFAULT_STAGE[status];
}

export function stageIndex(stage: EpisodeStage): number {
  return EPISODE_STAGES.indexOf(stage);
}

export function statusIndex(status: EpisodeStatus): number {
  return EPISODE_STATUSES.indexOf(status);
}

/** Acción principal de cada etapa. */
export type PrimaryAction =
  | "start_direction"
  | "answer_direction"
  | "generate_script"
  | "resolve_verification"
  | "prepare_assets"
  | "mark_recorded"
  | "link_video"
  | "await_publication"
  | "share_and_reply"
  | "evaluate"
  | "done";

/**
 * Fase del plan en que la acción queda disponible. Las de Fase 1 se pueden
 * ejecutar hoy; las demás muestran el botón deshabilitado y permiten marcar la
 * etapa como hecha a mano para no bloquear el flujo.
 */
export const ACTION_PHASE: Record<PrimaryAction, number> = {
  start_direction: 1,
  answer_direction: 2,
  generate_script: 2,
  resolve_verification: 2,
  prepare_assets: 3,
  mark_recorded: 1,
  link_video: 1,
  await_publication: 1,
  share_and_reply: 4,
  evaluate: 4,
  done: 1,
};

export const CURRENT_PHASE = 1;

export interface EpisodeLike {
  status: EpisodeStatus;
  stage: EpisodeStage;
  publishDate: DateKey | null;
  recordDate: DateKey | null;
  youtubeVideoId: string | null;
  /** Fecha local (zona del canal) en que YouTube lo publicó. */
  publishedOn: DateKey | null;
  evaluatedAt: Date | null;
  archivedAt: Date | null;
}

export interface NextStep {
  stage: EpisodeStage;
  action: PrimaryAction;
  /** La acción se puede ejecutar en esta fase de la app. */
  available: boolean;
  /** Fecha desde la que se puede ejecutar (p. ej. evaluación a los 7 días). */
  availableFrom: DateKey | null;
  /** Permite "marcar etapa como hecha" en lugar de la acción principal. */
  canSkip: boolean;
}

export const EVALUATION_DELAY_DAYS = 7;

export function nextStep(episode: EpisodeLike, today: DateKey): NextStep {
  const { stage } = episode;
  const make = (action: PrimaryAction, extra: Partial<NextStep> = {}): NextStep => {
    const available = ACTION_PHASE[action] <= CURRENT_PHASE;
    return {
      stage,
      action,
      available,
      availableFrom: null,
      canSkip: !available && action !== "evaluate",
      ...extra,
    };
  };

  switch (stage) {
    case "planning":
      return make("start_direction");
    case "direction":
      return make("answer_direction");
    case "script":
      return make("generate_script");
    case "verification":
      return make("resolve_verification");
    case "preparation":
      return make("prepare_assets");
    case "recording":
      return make("mark_recorded");
    case "publication":
      return episode.status === "scheduled"
        ? make("await_publication", { available: false, canSkip: false })
        : make("link_video");
    case "distribution":
      return make("share_and_reply");
    case "evaluation": {
      if (episode.evaluatedAt) return make("done", { available: false, canSkip: false });
      const from = episode.publishedOn ? addDays(episode.publishedOn, EVALUATION_DELAY_DAYS) : null;
      const reached = from !== null && diffDays(from, today) >= 0;
      return make("evaluate", {
        availableFrom: from,
        available: reached && ACTION_PHASE.evaluate <= CURRENT_PHASE,
        canSkip: false,
      });
    }
  }
}

export interface StageChange {
  stage: EpisodeStage;
  status: EpisodeStatus;
}

/**
 * Resultado de completar la etapa actual (con la acción principal o
 * marcándola a mano). Devuelve `null` si la etapa no se completa a mano
 * (esperar a que YouTube publique, o evaluación ya hecha).
 */
export function completeStage(episode: EpisodeLike): StageChange | null {
  switch (episode.stage) {
    case "planning":
      return { stage: "direction", status: "script" };
    case "direction":
      return { stage: "script", status: "script" };
    case "script":
      return { stage: "verification", status: "script" };
    case "verification":
      return { stage: "preparation", status: "to_record" };
    case "preparation":
      return { stage: "recording", status: "to_record" };
    case "recording":
      return { stage: "publication", status: "editing" };
    case "publication":
      // Al vincular el video queda Programado; el paso a Publicado lo hace la sincronización.
      return episode.status === "scheduled" ? null : { stage: "publication", status: "scheduled" };
    case "distribution":
      return { stage: "evaluation", status: "published" };
    case "evaluation":
      return null;
  }
}

/**
 * Cambio manual de estado (arrastre en el tablero o selector). Si el estado
 * no cambia, la etapa se conserva.
 */
export function changeStatus(episode: EpisodeLike, to: EpisodeStatus): StageChange {
  if (episode.status === to) return { stage: episode.stage, status: to };
  return { stage: defaultStageFor(to), status: to };
}

/**
 * Quién puede mover un episodio de un estado a otro. El editor de video solo
 * puede pasar de "Por grabar" a "En edición" (y devolverlo); el guionista y el
 * lector no mueven episodios.
 */
export function canChangeStatus(role: Role, from: EpisodeStatus, to: EpisodeStatus): boolean {
  if (from === to) return true;
  if (can(role, "manage_episodes")) return true;
  if (can(role, "edit_video")) {
    return (from === "to_record" && to === "editing") || (from === "editing" && to === "to_record");
  }
  return false;
}

/** Estado que corresponde según lo que dice YouTube del video vinculado. */
export interface YouTubeVideoState {
  privacyStatus: "public" | "private" | "unlisted";
  /** Fecha programada de publicación (videos privados con publishAt). */
  publishAt: Date | null;
  /** Momento en que el video pasó a público, si ya lo está. */
  publishedAt: Date | null;
}

/**
 * Avance automático a Programado y Publicado leyendo YouTube. Nunca hace
 * retroceder un episodio.
 */
export function autoAdvanceFromYouTube(
  episode: EpisodeLike,
  video: YouTubeVideoState,
): StageChange | null {
  if (episode.archivedAt) return null;
  const isPublic = video.privacyStatus === "public";
  if (isPublic) {
    if (episode.status === "published") return null;
    return { stage: "distribution", status: "published" };
  }
  if (video.publishAt && statusIndex(episode.status) < statusIndex("scheduled")) {
    return { stage: "publication", status: "scheduled" };
  }
  return null;
}
