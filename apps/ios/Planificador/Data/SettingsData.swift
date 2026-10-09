import CryptoKit
import Foundation
import PlanificadorCore
import Security
import Supabase

/// Configuración del canal y del espacio (`/c/[id]/ajustes` y `/espacio/[id]`):
/// todo lo que RLS deja hacer directo con `configure_channel` o `manage_members`.

struct ChannelProfile: Codable, Hashable {
    var hosts: [String]
    var audience: String
    var tone: String
}

struct ChannelDetails: Decodable, Hashable {
    let id: String
    let workspaceId: String
    let name: String
    let language: String
    let timezone: String
    let codePrefix: String
    let weeklyGoal: Int
    let publishWeekdays: [Int]
    let recordWeekdays: [Int]
    let formats: [String]
    let icsToken: String?
    let youtubeHandle: String?
    /// El jsonb completo, para no perder claves que la app no conoce.
    let profileRaw: [String: JSONAny]

    enum CodingKeys: String, CodingKey {
        case id, name, language, timezone, formats, profile
        case workspaceId = "workspace_id"
        case codePrefix = "code_prefix"
        case weeklyGoal = "weekly_goal"
        case publishWeekdays = "publish_weekdays"
        case recordWeekdays = "record_weekdays"
        case icsToken = "ics_token"
        case youtubeHandle = "youtube_handle"
    }

    static let columns =
        "id, workspace_id, name, language, timezone, code_prefix, weekly_goal, publish_weekdays, record_weekdays, formats, ics_token, youtube_handle, profile"

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        workspaceId = try c.decode(String.self, forKey: .workspaceId)
        name = try c.decode(String.self, forKey: .name)
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? "es"
        timezone = try c.decodeIfPresent(String.self, forKey: .timezone) ?? defaultTimeZone
        codePrefix = try c.decodeIfPresent(String.self, forKey: .codePrefix) ?? "EP"
        weeklyGoal = try c.decodeIfPresent(Int.self, forKey: .weeklyGoal) ?? 1
        publishWeekdays = try c.decodeIfPresent([Int].self, forKey: .publishWeekdays) ?? []
        recordWeekdays = try c.decodeIfPresent([Int].self, forKey: .recordWeekdays) ?? []
        formats = try c.decodeIfPresent([String].self, forKey: .formats) ?? ["long"]
        icsToken = try c.decodeIfPresent(String.self, forKey: .icsToken)
        youtubeHandle = try c.decodeIfPresent(String.self, forKey: .youtubeHandle)
        profileRaw = (try? c.decodeIfPresent([String: JSONAny].self, forKey: .profile)) ?? [:]
    }

    var profile: ChannelProfile {
        let hosts: [String] = {
            if case let .array(items)? = profileRaw["hosts"] {
                return items.compactMap { if case let .string(s) = $0 { return s } else { return nil } }
            }
            return []
        }()
        func text(_ key: String) -> String {
            if case let .string(s)? = profileRaw[key] { return s }
            return ""
        }
        return ChannelProfile(hosts: hosts, audience: text("audience"), tone: text("tone"))
    }
}

struct ProfileUpdate: Encodable {
    let name: String
    let language: String
    let timezone: String
    let codePrefix: String
    let profile: [String: JSONAny]

    enum CodingKeys: String, CodingKey {
        case name, language, timezone, profile
        case codePrefix = "code_prefix"
    }
}

struct RhythmUpdate: Encodable {
    let weeklyGoal: Int
    let publishWeekdays: [Int]
    let recordWeekdays: [Int]
    let formats: [String]

    enum CodingKeys: String, CodingKey {
        case formats
        case weeklyGoal = "weekly_goal"
        case publishWeekdays = "publish_weekdays"
        case recordWeekdays = "record_weekdays"
    }
}

struct PillarFull: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let color: String
    let position: Int
    let archivedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, description, color, position
        case archivedAt = "archived_at"
    }

    static let columns = "id, name, description, color, position, archived_at"
}

struct PillarWrite: Encodable {
    var channelId: String?
    let name: String
    let description: String
    let color: String
    var position: Int?

    enum CodingKeys: String, CodingKey {
        case name, description, color, position
        case channelId = "channel_id"
    }
}

struct ChecklistStepWrite: Encodable {
    let channelId: String
    let label: String
    let phase: ChecklistPhase
    let position: Int

    enum CodingKeys: String, CodingKey {
        case label, phase, position
        case channelId = "channel_id"
    }
}

struct LabelUpdate: Encodable { let label: String }
struct PositionUpdate: Encodable { let position: Int }

struct ConnectionInfo: Decodable, Hashable {
    let status: String?
    let lastSyncedAt: String?
    let lastError: String?

    enum CodingKeys: String, CodingKey {
        case status
        case lastSyncedAt = "last_synced_at"
        case lastError = "last_error"
    }

    var statusLabel: String {
        switch status {
        case "active": return "Conectado"
        case "needs_reauth": return "Hay que volver a conectar"
        case "revoked": return "Desconectado"
        case nil: return "Sin conectar"
        default: return status ?? ""
        }
    }
}

struct WorkspaceCredits: Decodable, Hashable {
    let monthly: Int?
    let used: FlexNumber?
    let remaining: FlexNumber?
}

struct MemberRow: Decodable, Identifiable, Hashable {
    let id: String
    let userId: String
    let role: Role
    let channelIds: [String]?
    let profile: ProfileRef?

    enum CodingKeys: String, CodingKey {
        case id, role, profile
        case userId = "user_id"
        case channelIds = "channel_ids"
    }

    static let columns = "id, user_id, role, channel_ids, profile:profiles(full_name, email)"
}

struct InvitationRow: Decodable, Identifiable, Hashable {
    let id: String
    let email: String?
    let role: Role?
    let channelIds: [String]?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case id, email, role
        case channelIds = "channel_ids"
        case expiresAt = "expires_at"
    }

    static let columns = "id, email, role, channel_ids, expires_at"
}

struct InvitationInsert: Encodable {
    let kind = "workspace"
    let workspaceId: String
    let email: String
    let role: Role
    let channelIds: [String]?
    let tokenHash: String
    let invitedBy: String?

    enum CodingKeys: String, CodingKey {
        case kind, email, role
        case workspaceId = "workspace_id"
        case channelIds = "channel_ids"
        case tokenHash = "token_hash"
        case invitedBy = "invited_by"
    }
}

/// Token del enlace de invitación y su hash (igual a `public.hash_invitation_token`).
enum InvitationToken {
    static func make() -> (token: String, hash: String) {
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let token = Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return (token, hash(token))
    }

    static func hash(_ token: String) -> String {
        SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Roles que un rol puede asignar (`assignableRoles`): el propietario todos,
/// el administrador todos menos propietario. Nadie invita como propietario.
func invitableRoles(_ role: Role?) -> [Role] {
    switch role {
    case .owner, .admin: return [.admin, .producer, .writer, .videoEditor, .viewer].filter { role == .owner || $0 != .owner }
    default: return []
    }
}

extension AppModel {
    // MARK: Canal

    func channelDetails() async throws -> ChannelDetails {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        return try await client.from("channels").select(ChannelDetails.columns)
            .eq("id", value: channelId).single().execute().value
    }

    func saveProfile(_ details: ChannelDetails, name: String, language: String, timezone: String,
                     codePrefix: String, profile: ChannelProfile) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        var merged = details.profileRaw
        merged["hosts"] = .array(profile.hosts.map { .string($0) })
        merged["audience"] = .string(profile.audience)
        merged["tone"] = .string(profile.tone)
        try await client.from("channels").update(ProfileUpdate(
            name: name, language: language, timezone: timezone, codePrefix: codePrefix, profile: merged
        )).eq("id", value: details.id).execute()
        await loadWorkspace()
    }

    func saveRhythm(_ details: ChannelDetails, _ update: RhythmUpdate) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        try await client.from("channels").update(update).eq("id", value: details.id).execute()
        await loadWorkspace()
    }

    func allPillars() async throws -> [PillarFull] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        return try await client.from("pillars").select(PillarFull.columns)
            .eq("channel_id", value: channelId).order("position").execute().value
    }

    func savePillar(_ write: PillarWrite, id: String?) async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        if let id {
            try await client.from("pillars").update(write).eq("id", value: id).eq("channel_id", value: channelId).execute()
        } else {
            var insert = write
            insert.channelId = channelId
            insert.position = try await allPillars().count
            try await client.from("pillars").insert(insert).execute()
        }
        await loadEpisodes()
    }

    func setPillarArchived(_ pillar: PillarFull, _ archived: Bool) async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        try await client.from("pillars")
            .update(ArchiveUpdate(archivedAt: archived ? ISO8601DateFormatter().string(from: Date()) : nil))
            .eq("id", value: pillar.id).eq("channel_id", value: channelId).execute()
        await loadEpisodes()
    }

    func allChecklistSteps() async throws -> [ChecklistStepRow] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        return try await client.from("checklist_steps").select(ChecklistStepRow.columns)
            .eq("channel_id", value: channelId).order("position").execute().value
    }

    func addChecklistStep(label: String, phase: ChecklistPhase) async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        let last = try await allChecklistSteps().filter { $0.phase == phase }.map(\.position).max() ?? -1
        try await client.from("checklist_steps")
            .insert(ChecklistStepWrite(channelId: channelId, label: label, phase: phase, position: last + 1))
            .execute()
        await loadEpisodes()
    }

    func renameChecklistStep(_ step: ChecklistStepRow, label: String) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        try await client.from("checklist_steps").update(LabelUpdate(label: label)).eq("id", value: step.id).execute()
        await loadEpisodes()
    }

    /// Nuevo orden de los pasos activos de una fase (`reorderSteps`): 0, 1, 2…
    func reorderChecklist(_ ordered: [ChecklistStepRow]) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        for (position, step) in ordered.enumerated() where step.position != position {
            try await client.from("checklist_steps").update(PositionUpdate(position: position)).eq("id", value: step.id).execute()
        }
        await loadEpisodes()
    }

    func setChecklistStepArchived(_ step: ChecklistStepRow, _ archived: Bool) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        try await client.from("checklist_steps")
            .update(ArchiveUpdate(archivedAt: archived ? ISO8601DateFormatter().string(from: Date()) : nil))
            .eq("id", value: step.id).execute()
        await loadEpisodes()
    }

    func regenerateIcsToken() async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        try await client.rpc("regenerate_ics_token", params: ["ch": channelId]).execute()
        await loadWorkspace()
    }

    func connectionInfo() async -> ConnectionInfo? {
        guard let client = supabase, let channelId = selectedChannelId else { return nil }
        let rows: [ConnectionInfo]? = try? await client
            .rpc("channel_connection_info", params: ["ch": channelId]).execute().value
        return rows?.first
    }

    // MARK: Espacio y equipo

    func credits(workspaceId: String) async -> WorkspaceCredits? {
        guard let client = supabase else { return nil }
        let rows: [WorkspaceCredits]? = try? await client
            .rpc("workspace_credits", params: ["ws": workspaceId]).execute().value
        return rows?.first
    }

    func members(workspaceId: String) async throws -> [MemberRow] {
        guard let client = supabase else { return [] }
        return try await client.from("memberships").select(MemberRow.columns)
            .eq("workspace_id", value: workspaceId).order("created_at").execute().value
    }

    func pendingWorkspaceInvitations(workspaceId: String) async -> [InvitationRow] {
        guard let client = supabase else { return [] }
        let rows: [InvitationRow]? = try? await client.from("invitations").select(InvitationRow.columns)
            .eq("workspace_id", value: workspaceId)
            .filter("accepted_at", operator: "is", value: "null")
            .order("created_at", ascending: false)
            .execute().value
        return rows ?? []
    }

    /// Invita a alguien al espacio y devuelve el enlace para compartir (`inviteMember`).
    func invite(workspaceId: String, email: String, role: Role, channelIds: [String]?) async throws -> URL {
        guard let client = supabase else { throw AppError.notReady }
        let myRole = memberships.first { $0.workspaceId == workspaceId }?.role
        guard invitableRoles(myRole).contains(role) else { throw AppError.forbiddenEdit }
        let (token, hash) = InvitationToken.make()
        try await client.from("invitations").insert(InvitationInsert(
            workspaceId: workspaceId,
            email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            role: role,
            channelIds: (channelIds?.isEmpty ?? true) ? nil : channelIds,
            tokenHash: hash,
            invitedBy: userId
        )).execute()
        return AppConfig.webURL.appendingPathComponent("invite/\(token)")
    }

    func revokeInvitation(_ invitation: InvitationRow) async throws {
        guard let client = supabase else { throw AppError.notReady }
        try await client.from("invitations").delete().eq("id", value: invitation.id).execute()
    }

    /// Salir del espacio (la única escritura de membresías permitida al cliente).
    func leaveWorkspace(_ workspaceId: String) async throws {
        guard let client = supabase, let userId else { throw AppError.notReady }
        try await client.from("memberships").delete()
            .eq("workspace_id", value: workspaceId).eq("user_id", value: userId).execute()
        await loadWorkspace()
    }
}
