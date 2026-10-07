import type { EpisodeStage, EpisodeStatus } from "@planificador/core";

/** Episodio serializado para las vistas de Producción (cliente). */
export interface ProductionEpisode {
  id: string;
  number: number;
  code: string;
  title: string;
  status: EpisodeStatus;
  stage: EpisodeStage;
  format: string;
  publishDate: string | null;
  recordDate: string | null;
  pillar: { name: string; color: string } | null;
  checklist: { done: number; total: number };
  hasVideo: boolean;
  archived: boolean;
  boardPosition: number;
}
