/**
 * Checklists por identificador: el progreso de un episodio se guarda por
 * `stepId`, así que renombrar un paso ya no lo desmarca en todos los episodios.
 */
export const CHECKLIST_PHASES = ["before_publish", "after_publish"] as const;
export type ChecklistPhase = (typeof CHECKLIST_PHASES)[number];

export interface ChecklistStep {
  id: string;
  label: string;
  phase: ChecklistPhase;
  position: number;
  archivedAt: Date | null;
}

export interface ChecklistProgress {
  done: number;
  total: number;
  ratio: number;
}

export function activeSteps(steps: readonly ChecklistStep[], phase?: ChecklistPhase): ChecklistStep[] {
  return steps
    .filter((s) => s.archivedAt === null && (phase === undefined || s.phase === phase))
    .sort((a, b) => a.position - b.position);
}

/**
 * Progreso contando solo pasos activos. Pasos archivados que el episodio había
 * marcado no cuentan, pero su marca se conserva por si se restauran.
 */
export function checklistProgress(
  steps: readonly ChecklistStep[],
  doneStepIds: ReadonlySet<string>,
  phase?: ChecklistPhase,
): ChecklistProgress {
  const active = activeSteps(steps, phase);
  const done = active.filter((s) => doneStepIds.has(s.id)).length;
  return { done, total: active.length, ratio: active.length === 0 ? 1 : done / active.length };
}

/**
 * Reordena pasos moviendo `stepId` a `toIndex` dentro de su fase. Devuelve las
 * nuevas posiciones (0..n-1) para guardar.
 */
export function reorderSteps(
  steps: readonly ChecklistStep[],
  stepId: string,
  toIndex: number,
): { id: string; position: number }[] {
  const step = steps.find((s) => s.id === stepId);
  if (!step) return [];
  const list = activeSteps(steps, step.phase).filter((s) => s.id !== stepId);
  const index = Math.max(0, Math.min(toIndex, list.length));
  list.splice(index, 0, step);
  return list.map((s, i) => ({ id: s.id, position: i }));
}

/** Plantilla base para un canal nuevo. */
export const DEFAULT_CHECKLIST: { label: string; phase: ChecklistPhase }[] = [
  { label: "Guion verificado", phase: "before_publish" },
  { label: "Ayudas visuales listas", phase: "before_publish" },
  { label: "Miniatura lista", phase: "before_publish" },
  { label: "Título y descripción", phase: "before_publish" },
  { label: "Capítulos y tarjetas", phase: "before_publish" },
  { label: "Compartir en redes", phase: "after_publish" },
  { label: "Enviar boletín", phase: "after_publish" },
  { label: "Responder comentarios del primer día", phase: "after_publish" },
];
