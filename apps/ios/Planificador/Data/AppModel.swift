import Foundation
import Observation
import PlanificadorCore
import Supabase

/// Estado global: sesión, espacios, canales y episodios del canal elegido.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case loading
        case signedOut
        case signedIn
    }

    private static let lastChannelKey = "last_channel"

    var phase: Phase = .loading
    var email: String?
    var userId: String?

    var memberships: [MembershipRow] = []
    var channels: [ChannelRow] = []
    var pendingInvitations: [PendingInvitation] = []
    var isLoadingWorkspace = false
    var workspaceError: String?

    private(set) var selectedChannelId: String?

    var episodes: [EpisodeRow] = []
    var pillars: [PillarRow] = []
    var checklistSteps: [ChecklistStepRow] = []
    /// Pasos marcados por episodio.
    var checklistDone: [String: Set<String>] = [:]
    var isLoadingEpisodes = false
    var episodesError: String?

    // MARK: - Derivados

    var selectedChannel: ChannelRow? {
        channels.first { $0.id == selectedChannelId }
    }

    /// Membresía del espacio del canal elegido.
    var membership: MembershipRow? {
        guard let channel = selectedChannel else { return nil }
        return memberships.first { $0.workspaceId == channel.workspaceId }
    }

    func can(_ permission: Permission) -> Bool {
        guard let channel = selectedChannel, let membership else { return false }
        return canOnChannel(role: membership.role, channelIds: membership.channelIds, channelId: channel.id, permission)
    }

    func canMove(_ episode: EpisodeRow, to status: EpisodeStatus) -> Bool {
        guard let channel = selectedChannel, let membership,
              canOnChannel(role: membership.role, channelIds: membership.channelIds, channelId: channel.id, .read)
        else { return false }
        return canChangeStatus(membership.role, from: episode.status, to: status)
    }

    var timeZone: String { selectedChannel?.timezone ?? defaultTimeZone }

    var today: DateKey { localDateKey(Date(), timeZone: timeZone) }

    var plannedEpisodes: [PlannedEpisode] {
        episodes.map { $0.planned(timeZone: timeZone) }
    }

    func episode(id: String) -> EpisodeRow? {
        episodes.first { $0.id == id }
    }

    // MARK: - Sesión

    /// Escucha la sesión de Supabase durante toda la vida de la app.
    func start() async {
        guard let client = supabase else { return }
        // Sin sesión guardada se muestra Entrar de inmediato, sin esperar el
        // primer evento de Supabase.
        if client.auth.currentSession == nil { phase = .signedOut }
        for await (event, session) in client.auth.authStateChanges {
            switch event {
            case .initialSession, .signedIn, .userUpdated:
                if let session {
                    let changedUser = userId != session.user.id.uuidString.lowercased()
                    email = session.user.email
                    userId = session.user.id.uuidString.lowercased()
                    phase = .signedIn
                    if changedUser || channels.isEmpty { await loadWorkspace() }
                } else {
                    reset()
                }
            case .signedOut, .userDeleted:
                reset()
            default:
                break
            }
        }
    }

    func signOut() async {
        try? await supabase?.auth.signOut()
        reset()
    }

    private func reset() {
        phase = .signedOut
        email = nil
        userId = nil
        memberships = []
        channels = []
        pendingInvitations = []
        episodes = []
        pillars = []
        checklistSteps = []
        checklistDone = [:]
        selectedChannelId = nil
        Task { await NotificationScheduler.shared.clear() }
        workspaceError = nil
        episodesError = nil
    }

    // MARK: - Datos

    /// Espacios y canales visibles (RLS filtra los canales según la membresía).
    /// Elige el último canal usado o el primero por nombre, como `/app` en la web.
    func loadWorkspace() async {
        guard let client = supabase, let userId else { return }
        isLoadingWorkspace = true
        workspaceError = nil
        defer { isLoadingWorkspace = false }
        do {
            async let membershipsQuery: [MembershipRow] = client
                .from("memberships")
                .select(MembershipRow.columns)
                .eq("user_id", value: userId)
                .execute()
                .value
            async let channelsQuery: [ChannelRow] = client
                .from("channels")
                .select(ChannelRow.columns)
                .order("name")
                .execute()
                .value
            memberships = try await membershipsQuery
                .sorted { ($0.workspace?.name ?? "") < ($1.workspace?.name ?? "") }
            channels = try await channelsQuery

            let last = UserDefaults.standard.string(forKey: Self.lastChannelKey)
            let target = channels.first { $0.id == selectedChannelId }
                ?? channels.first { $0.id == last }
                ?? channels.first
            await selectChannel(target?.id)

            if channels.isEmpty {
                pendingInvitations = try await client.rpc("my_pending_invitations").execute().value
            }
        } catch {
            workspaceError = error.localizedDescription
        }
    }

    /// Cambia de canal, lo recuerda para la próxima vez y carga sus episodios.
    func selectChannel(_ id: String?) async {
        if id != selectedChannelId { episodes = [] }
        selectedChannelId = id
        UserDefaults.standard.set(id, forKey: Self.lastChannelKey)
        await loadEpisodes()
    }

    /// Episodios no archivados del canal, en el orden del tablero (`getEpisodes`).
    func loadEpisodes() async {
        guard let client = supabase, let channelId = selectedChannelId else { return }
        isLoadingEpisodes = true
        episodesError = nil
        defer { isLoadingEpisodes = false }
        do {
            async let episodesQuery: [EpisodeRow] = client
                .from("episodes")
                .select(EpisodeRow.columns)
                .eq("channel_id", value: channelId)
                .filter("archived_at", operator: "is", value: "null")
                .order("board_position")
                .order("number", ascending: false)
                .execute()
                .value
            async let pillarsQuery: [PillarRow] = client
                .from("pillars")
                .select(PillarRow.columns)
                .eq("channel_id", value: channelId)
                .filter("archived_at", operator: "is", value: "null")
                .order("position")
                .execute()
                .value
            async let stepsQuery: [ChecklistStepRow] = client
                .from("checklist_steps")
                .select(ChecklistStepRow.columns)
                .eq("channel_id", value: channelId)
                .filter("archived_at", operator: "is", value: "null")
                .order("position")
                .execute()
                .value
            async let itemsQuery: [ChecklistItemRow] = client
                .from("episode_checklist_items")
                .select("episode_id, step_id")
                .eq("channel_id", value: channelId)
                .execute()
                .value
            let (rows, pillarRows) = try await (episodesQuery, pillarsQuery)
            let (stepRows, itemRows) = try await (stepsQuery, itemsQuery)
            // Si el usuario cambió de canal mientras cargaba, se descarta.
            if channelId == selectedChannelId {
                episodes = rows
                pillars = pillarRows
                checklistSteps = stepRows
                checklistDone = Dictionary(grouping: itemRows, by: \.episodeId).mapValues { Set($0.map(\.stepId)) }
                await NotificationScheduler.shared.reschedule(model: self)
            }
        } catch {
            episodesError = error.localizedDescription
        }
    }

    /// Mueve un episodio de estado. La base vuelve a validar el permiso.
    func changeStatus(_ episode: EpisodeRow, to status: EpisodeStatus) async throws {
        guard let client = supabase, episode.status != status else { return }
        guard canMove(episode, to: status) else { throw AppError.forbidden }
        try await client
            .from("episodes")
            .update(StatusUpdate(status: status, stage: status.defaultStage))
            .eq("id", value: episode.id)
            .execute()
        await loadEpisodes()
    }

    // MARK: - Crear y editar (requiere manage_episodes, como la web)

    /// Crea un episodio en el canal elegido y devuelve su id.
    @discardableResult
    func createEpisode(_ draft: EpisodeDraft) async throws -> String {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.manageEpisodes) else { throw AppError.forbiddenEdit }
        let inserted: InsertedId = try await client
            .from("episodes")
            .insert(EpisodeInsert(
                channelId: channelId,
                title: draft.cleanTitle,
                format: draft.format,
                publishDate: draft.publishDate,
                recordDate: draft.recordDate,
                pillarId: draft.pillarId,
                createdBy: userId,
                ideaId: draft.ideaId
            ))
            .select("id")
            .single()
            .execute()
            .value
        // Como la web: la idea pasa a «En marcha» al convertirse en episodio.
        if let ideaId = draft.ideaId {
            try? await client.from("ideas").update(IdeaStatusUpdate(status: .inProgress)).eq("id", value: ideaId).execute()
        }
        await loadEpisodes()
        return inserted.id
    }

    func updateEpisode(_ episode: EpisodeRow, with draft: EpisodeDraft) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.manageEpisodes) else { throw AppError.forbiddenEdit }
        try await client
            .from("episodes")
            .update(EpisodeEdit(
                title: draft.cleanTitle,
                format: draft.format,
                publishDate: draft.publishDate,
                recordDate: draft.recordDate,
                pillarId: draft.pillarId,
                notes: draft.notes,
                priority: draft.priority,
                stance: draft.stance.trimmingCharacters(in: .whitespacesAndNewlines),
                stanceConfirmed: draft.stanceConfirmed,
                keywords: draft.keywords,
                episodeType: draft.episodeType,
                targetMinutes: draft.targetMinutes,
                sponsorship: draft.sponsorship,
                ownMeasurements: draft.ownMeasurements
            ))
            .eq("id", value: episode.id)
            .execute()
        await loadEpisodes()
    }

    /// Archiva el episodio (se puede recuperar desde la web).
    func archiveEpisode(_ episode: EpisodeRow) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.manageEpisodes) else { throw AppError.forbiddenEdit }
        try await client
            .from("episodes")
            .update(ArchiveUpdate(archivedAt: ISO8601DateFormatter().string(from: Date())))
            .eq("id", value: episode.id)
            .execute()
        await loadEpisodes()
    }

    // MARK: - Etapas, video, checklist y actividad

    func plannedEpisode(_ episode: EpisodeRow) -> PlannedEpisode {
        episode.planned(timeZone: timeZone)
    }

    func nextStepFor(_ episode: EpisodeRow) -> NextStep {
        nextStep(plannedEpisode(episode), today: today)
    }

    /// Quién puede ejecutar la acción principal (como `canAct` en la web).
    func canAct(on step: NextStep) -> Bool {
        if can(.manageEpisodes) { return true }
        if can(.editVideo) && step.action == .markRecorded { return true }
        if can(.writeScript) && [.direction, .script, .verification].contains(step.stage) { return true }
        return false
    }

    /// Completa la etapa actual (`completeEpisodeStage`).
    func completeCurrentStage(_ episode: EpisodeRow) async throws {
        guard let client = supabase else { throw AppError.notReady }
        let planned = plannedEpisode(episode)
        let step = nextStep(planned, today: today)
        guard step.available || step.canSkip, step.action != .linkVideo,
              let change = completeStage(planned)
        else { throw AppError.stageLocked }
        let allowed = can(.manageEpisodes) || (can(.editVideo) && episode.stage == .recording)
        guard allowed, canChangeStatus(membership?.role ?? .viewer, from: episode.status, to: change.status) else {
            throw AppError.forbiddenEdit
        }
        try await client
            .from("episodes")
            .update(StatusUpdate(status: change.status, stage: change.stage))
            .eq("id", value: episode.id)
            .execute()
        await loadEpisodes()
    }

    func videoInfo(_ videoId: String) async -> YouTubeVideoInfo? {
        guard let client = supabase, let channelId = selectedChannelId else { return nil }
        let rows: [YouTubeVideoInfo]? = try? await client
            .from("youtube_videos")
            .select(YouTubeVideoInfo.columns)
            .eq("channel_id", value: channelId)
            .eq("video_id", value: videoId)
            .limit(1)
            .execute()
            .value
        return rows?.first
    }

    /// Vincula el video de YouTube (`linkEpisodeVideo`). Si la sincronización
    /// ya lo conoce aplica su estado real; si no, queda Programado.
    func linkVideo(_ episode: EpisodeRow, input: String) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.manageEpisodes) else { throw AppError.forbiddenEdit }
        guard let videoId = parseYouTubeVideoId(input) else { throw AppError.invalidVideo }
        let info = await videoInfo(videoId)
        var linked = plannedEpisode(episode)
        linked.youtubeVideoId = videoId
        var update = VideoLinkUpdate(youtubeVideoId: videoId)
        update.change = stageChangeForLinkedVideo(
            linked,
            privacy: info?.privacy,
            publishAt: info?.publishAt.flatMap(Timestamp.parse)
        )
        update.publishedAt = info?.publishedAt
        update.scheduledAt = info?.publishAt
        try await client.from("episodes").update(update).eq("id", value: episode.id).execute()
        await loadEpisodes()
    }

    func unlinkVideo(_ episode: EpisodeRow) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.manageEpisodes) else { throw AppError.forbiddenEdit }
        try await client
            .from("episodes")
            .update(VideoLinkUpdate(youtubeVideoId: nil))
            .eq("id", value: episode.id)
            .execute()
        await loadEpisodes()
    }

    var canToggleChecklist: Bool { can(.manageEpisodes) || can(.editVideo) }

    func steps(_ phase: ChecklistPhase) -> [ChecklistStepRow] {
        checklistSteps.filter { $0.phase == phase }.sorted { $0.position < $1.position }
    }

    /// Progreso del checklist del episodio, contando solo pasos activos.
    func checklistProgress(_ episodeId: String, phase: ChecklistPhase? = nil) -> (done: Int, total: Int) {
        let active = checklistSteps.filter { phase == nil || $0.phase == phase }
        let done = checklistDone[episodeId] ?? []
        return (active.filter { done.contains($0.id) }.count, active.count)
    }

    /// Marca o desmarca un paso (`toggleChecklistItem`). Se aplica al momento
    /// en pantalla y se revierte si la base lo rechaza.
    func toggleChecklist(_ episodeId: String, stepId: String, done: Bool) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard canToggleChecklist else { throw AppError.forbiddenEdit }
        let previous = checklistDone[episodeId] ?? []
        var next = previous
        if done { next.insert(stepId) } else { next.remove(stepId) }
        checklistDone[episodeId] = next
        do {
            if done {
                try await client
                    .from("episode_checklist_items")
                    .upsert(
                        ChecklistItemInsert(episodeId: episodeId, stepId: stepId, doneBy: userId),
                        onConflict: "episode_id,step_id",
                        ignoreDuplicates: true
                    )
                    .execute()
            } else {
                try await client
                    .from("episode_checklist_items")
                    .delete()
                    .eq("episode_id", value: episodeId)
                    .eq("step_id", value: stepId)
                    .execute()
            }
        } catch {
            checklistDone[episodeId] = previous
            throw error
        }
    }

    func activity(_ episodeId: String) async -> [ActivityRow] {
        guard let client = supabase else { return [] }
        let rows: [ActivityRow]? = try? await client
            .from("activity_log")
            .select(ActivityRow.columns)
            .eq("episode_id", value: episodeId)
            .order("created_at", ascending: false)
            .limit(20)
            .execute()
            .value
        return rows ?? []
    }

    // MARK: - Todos mis canales y búsqueda

    /// Episodios activos de todos los canales visibles (`/todos`).
    func allChannelEpisodes() async throws -> [ChannelEpisodeRow] {
        guard let client = supabase, !channels.isEmpty else { return [] }
        return try await client
            .from("episodes")
            .select(ChannelEpisodeRow.columns)
            .in("channel_id", values: channels.map(\.id))
            .filter("archived_at", operator: "is", value: "null")
            .execute()
            .value
    }

    /// Busca episodios por título en todos los canales (paleta de comandos de la web).
    func searchEpisodes(_ query: String) async throws -> [ChannelEpisodeRow] {
        guard let client = supabase, !channels.isEmpty else { return [] }
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "%", with: "")
            .replacingOccurrences(of: "_", with: "\\_")
        guard !clean.isEmpty else { return [] }
        return try await client
            .from("episodes")
            .select(ChannelEpisodeRow.columns)
            .in("channel_id", values: channels.map(\.id))
            .filter("archived_at", operator: "is", value: "null")
            .ilike("title", pattern: "%\(clean)%")
            .order("updated_at", ascending: false)
            .limit(40)
            .execute()
            .value
    }

    func channel(id: String) -> ChannelRow? {
        channels.first { $0.id == id }
    }

    // MARK: - Ideas (requieren write_script, como la web)

    func ideas() async throws -> [IdeaRow] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        return try await client
            .from("ideas")
            .select(IdeaRow.columns)
            .eq("channel_id", value: channelId)
            .order("created_at", ascending: false)
            .execute()
            .value
    }

    func saveIdea(_ draft: IdeaDraft, editing idea: IdeaRow?) async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.writeScript) else { throw AppError.forbiddenEdit }
        var write = IdeaWrite(
            title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            notes: draft.notes,
            origin: draft.origin,
            status: draft.status,
            signals: Dictionary(uniqueKeysWithValues: draft.signals.map { ($0.key.rawValue, $0.value) })
        )
        if let idea {
            try await client.from("ideas").update(write).eq("id", value: idea.id).eq("channel_id", value: channelId).execute()
        } else {
            write.channelId = channelId
            write.createdBy = userId
            try await client.from("ideas").insert(write).execute()
        }
    }

    func setIdeaStatus(_ idea: IdeaRow, _ status: IdeaStatus) async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.writeScript) else { throw AppError.forbiddenEdit }
        try await client
            .from("ideas")
            .update(IdeaStatusUpdate(status: status))
            .eq("id", value: idea.id)
            .eq("channel_id", value: channelId)
            .execute()
    }

    // MARK: - Fechas y archivados

    enum DateField: String {
        case publish = "publish_date"
        case record = "record_date"
    }

    /// Cambia la fecha de publicación o grabación (`rescheduleEpisode`). `nil` la quita.
    func reschedule(_ episode: EpisodeRow, field: DateField, to date: DateKey?) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.manageEpisodes) else { throw AppError.forbiddenEdit }
        try await client
            .from("episodes")
            .update(DateUpdate(field: field.rawValue, date: date))
            .eq("id", value: episode.id)
            .execute()
        await loadEpisodes()
    }

    /// Episodios archivados del canal (vista «Archivados» de Producción).
    func archivedEpisodes() async throws -> [EpisodeRow] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        return try await client
            .from("episodes")
            .select(EpisodeRow.columns)
            .eq("channel_id", value: channelId)
            .filter("archived_at", operator: "not.is", value: "null")
            .order("archived_at", ascending: false)
            .execute()
            .value
    }

    func restoreEpisode(_ episode: EpisodeRow) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.manageEpisodes) else { throw AppError.forbiddenEdit }
        try await client
            .from("episodes")
            .update(ArchiveUpdate(archivedAt: nil))
            .eq("id", value: episode.id)
            .execute()
        await loadEpisodes()
    }

    func pillar(id: String?) -> PillarRow? {
        guard let id else { return nil }
        return pillars.first { $0.id == id }
    }

    func acceptInvitation(_ invitation: PendingInvitation) async throws {
        guard let client = supabase else { return }
        try await client
            .rpc("accept_invitation_by_id", params: ["invitation": invitation.id])
            .execute()
        await loadWorkspace()
    }
}

enum AppError: LocalizedError {
    case forbidden
    case forbiddenEdit
    case notReady
    case stageLocked
    case invalidVideo

    var errorDescription: String? {
        switch self {
        case .forbidden: return "Tu rol no puede mover el episodio a ese estado."
        case .forbiddenEdit: return "Tu rol no permite esta acción."
        case .notReady: return "No hay un canal elegido."
        case .stageLocked: return "Esta etapa no se puede completar todavía."
        case .invalidVideo: return "No reconocemos ese enlace de YouTube."
        }
    }
}
