/**
 * Umbrales de alertas y señales del canal. No hay código del panel anterior,
 * así que estos valores son una propuesta inicial documentada en
 * `docs/decisiones.md`: ajústalos aquí y todas las pantallas cambian a la vez.
 */
export const THRESHOLDS = {
  alerts: {
    /** Días antes de publicar en que un episodio todavía en Planeado/Guion es riesgo. */
    notReadyWarnDays: 5,
    notReadyCriticalDays: 2,
    /** Días sin cambiar de estado para considerar un episodio estancado. */
    staleDays: 14,
    /** Semanas hacia adelante que se revisan para cobertura. */
    coverageLookaheadWeeks: 2,
  },
  signals: {
    /** Días desde la última publicación. */
    daysSincePublish: { ok: 8, warn: 15 },
    /** Porcentaje de la meta semanal cubierto esta semana. */
    weekCoverage: { ok: 1, warn: 0.5 },
    /** Semanas futuras con episodios listos o en producción (cola). */
    pipelineWeeks: { ok: 2, warn: 1 },
    /** Porcentaje de episodios publicados en la fecha planeada (últimas 8 semanas). */
    onTimeRate: { ok: 0.8, warn: 0.5 },
  },
} as const;
