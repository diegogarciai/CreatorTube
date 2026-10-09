/// Umbrales de alertas y señales del canal (`packages/core/src/thresholds.ts`).
/// Deben coincidir con la web: si se ajustan allá, se ajustan aquí.
public enum Thresholds {
    public enum Alerts {
        /// Días antes de publicar en que un episodio todavía en Planeado/Guion es riesgo.
        public static let notReadyWarnDays = 5
        public static let notReadyCriticalDays = 2
        /// Días sin cambiar de estado para considerar un episodio estancado.
        public static let staleDays = 14
        /// Semanas hacia adelante que se revisan para cobertura.
        public static let coverageLookaheadWeeks = 2
    }

    public struct Band: Sendable {
        public let ok: Double
        public let warn: Double
    }

    public enum Signals {
        /// Días desde la última publicación (más bajo es mejor).
        public static let daysSincePublish = Band(ok: 8, warn: 15)
        /// Fracción de la meta semanal cubierta esta semana.
        public static let weekCoverage = Band(ok: 1, warn: 0.5)
        /// Semanas futuras con episodios en producción (cola).
        public static let pipelineWeeks = Band(ok: 2, warn: 1)
        /// Fracción de episodios publicados en la fecha planeada (8 semanas).
        public static let onTimeRate = Band(ok: 0.8, warn: 0.5)
    }
}
