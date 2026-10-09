import Foundation

/// Estados del episodio, en el orden del tablero (`EPISODE_STATUSES`).
public enum EpisodeStatus: String, CaseIterable, Codable, Sendable {
    case planned
    case script
    case toRecord = "to_record"
    case editing
    case scheduled
    case published

    public var index: Int { Self.allCases.firstIndex(of: self)! }

    public var label: String {
        switch self {
        case .planned: return "Planeado"
        case .script: return "Guion"
        case .toRecord: return "Por grabar"
        case .editing: return "En edición"
        case .scheduled: return "Programado"
        case .published: return "Publicado"
        }
    }

    /// Etapa que corresponde al mover el episodio a este estado (`defaultStageFor`).
    public var defaultStage: EpisodeStage {
        switch self {
        case .planned: return .planning
        case .script: return .direction
        case .toRecord: return .preparation
        case .editing, .scheduled: return .publication
        case .published: return .distribution
        }
    }
}

/// Etapas de la página del episodio (`EPISODE_STAGES`).
public enum EpisodeStage: String, CaseIterable, Codable, Sendable {
    case planning
    case direction
    case script
    case verification
    case preparation
    case recording
    case publication
    case distribution
    case evaluation

    public var index: Int { Self.allCases.firstIndex(of: self)! }

    public var label: String {
        switch self {
        case .planning: return "Planeación"
        case .direction: return "Dirección"
        case .script: return "Guion"
        case .verification: return "Verificación"
        case .preparation: return "Preparación"
        case .recording: return "Grabación y edición"
        case .publication: return "Publicación"
        case .distribution: return "Difusión"
        case .evaluation: return "Evaluación"
        }
    }
}

public enum EpisodeFormat: String, CaseIterable, Codable, Sendable {
    case long, short, live, podcast

    public var label: String {
        switch self {
        case .long: return "Largo"
        case .short: return "Short"
        case .live: return "Directo"
        case .podcast: return "Podcast"
        }
    }
}

/// Datos mínimos de un episodio para los cálculos de Inicio (`PlannedEpisode`).
public struct PlannedEpisode: Equatable, Sendable {
    public var id: String
    public var title: String
    public var status: EpisodeStatus
    public var stage: EpisodeStage
    public var publishDate: DateKey?
    public var recordDate: DateKey?
    public var youtubeVideoId: String?
    /// Fecha local (zona del canal) en que salió en YouTube.
    public var publishedOn: DateKey?
    public var archivedAt: Date?
    /// Instante del último cambio de estado.
    public var statusChangedAt: Date

    public init(
        id: String,
        title: String,
        status: EpisodeStatus = .planned,
        stage: EpisodeStage = .planning,
        publishDate: DateKey? = nil,
        recordDate: DateKey? = nil,
        youtubeVideoId: String? = nil,
        publishedOn: DateKey? = nil,
        archivedAt: Date? = nil,
        statusChangedAt: Date
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.stage = stage
        self.publishDate = publishDate
        self.recordDate = recordDate
        self.youtubeVideoId = youtubeVideoId
        self.publishedOn = publishedOn
        self.archivedAt = archivedAt
        self.statusChangedAt = statusChangedAt
    }

    public var isActive: Bool { archivedAt == nil }

    /// Fecha en que cuenta el episodio para la semana: la de publicación real si
    /// ya salió; si no, la planeada.
    public var effectiveDate: DateKey? { publishedOn ?? publishDate }
}
