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
        selectedChannelId = nil
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
            let rows: [EpisodeRow] = try await client
                .from("episodes")
                .select(EpisodeRow.columns)
                .eq("channel_id", value: channelId)
                .filter("archived_at", operator: "is", value: "null")
                .order("board_position")
                .order("number", ascending: false)
                .execute()
                .value
            // Si el usuario cambió de canal mientras cargaba, se descarta.
            if channelId == selectedChannelId { episodes = rows }
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

    var errorDescription: String? {
        switch self {
        case .forbidden: return "Tu rol no puede mover el episodio a ese estado."
        }
    }
}
