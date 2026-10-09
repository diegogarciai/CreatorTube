import Foundation
import PlanificadorCore
import Supabase

/// Canal nuevo sin YouTube, terminar la configuración y aceptar invitaciones
/// por enlace (`createManualChannel`, `completeOnboarding`, `acceptInvitation`).

/// Plantilla base de checklist para un canal nuevo (`DEFAULT_CHECKLIST`).
let defaultChecklist: [(label: String, phase: ChecklistPhase)] = [
    ("Guion verificado", .beforePublish),
    ("Ayudas visuales listas", .beforePublish),
    ("Miniatura lista", .beforePublish),
    ("Título y descripción", .beforePublish),
    ("Capítulos y tarjetas", .beforePublish),
    ("Compartir en redes", .afterPublish),
    ("Enviar boletín", .afterPublish),
    ("Responder comentarios del primer día", .afterPublish),
]

struct ChannelInsert: Encodable {
    let workspaceId: String
    let name: String

    enum CodingKeys: String, CodingKey {
        case name
        case workspaceId = "workspace_id"
    }
}

struct OnboardingUpdate: Encodable {
    let onboardingCompletedAt: String

    enum CodingKeys: String, CodingKey {
        case onboardingCompletedAt = "onboarding_completed_at"
    }
}

struct InvitationPreview: Decodable {
    let kind: String?
    let workspaceName: String?
    let role: Role?
    let expired: Bool?
    let accepted: Bool?

    enum CodingKeys: String, CodingKey {
        case kind, role, expired, accepted
        case workspaceName = "workspace_name"
    }
}

struct AcceptParams: Encodable {
    let token: String
    let workspaceName: String?

    enum CodingKeys: String, CodingKey {
        case token
        case workspaceName = "workspace_name"
    }
}

struct AcceptByIdParams: Encodable {
    let invitation: String
    let workspaceName: String?

    enum CodingKeys: String, CodingKey {
        case invitation
        case workspaceName = "workspace_name"
    }
}

/// Saca el token de un enlace `…/invite/<token>` o lo toma tal cual.
func invitationToken(from input: String) -> String {
    let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if let range = value.range(of: "/invite/") {
        let rest = value[range.upperBound...]
        return String(rest.split(whereSeparator: { $0 == "?" || $0 == "#" || $0 == "/" }).first ?? "")
            .removingPercentEncoding ?? String(rest)
    }
    return value
}

extension AppModel {
    /// Espacios donde la persona puede crear canales (`configure_channel`).
    var workspacesForNewChannel: [WorkspaceRef] {
        memberships.filter { can($0.role, .configureChannel) }.compactMap(\.workspace)
    }

    func createChannel(workspaceId: String, name: String) async throws {
        guard let client = supabase else { throw AppError.notReady }
        let created: InsertedId = try await client.from("channels")
            .insert(ChannelInsert(workspaceId: workspaceId, name: name))
            .select("id").single().execute().value
        let steps = defaultChecklist.enumerated().map { index, step in
            ChecklistStepWrite(channelId: created.id, label: step.label, phase: step.phase, position: index)
        }
        try? await client.from("checklist_steps").insert(steps).execute()
        await loadWorkspace()
        await selectChannel(created.id)
    }

    func completeOnboarding() async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        try await client.from("channels")
            .update(OnboardingUpdate(onboardingCompletedAt: ISO8601DateFormatter().string(from: Date())))
            .eq("id", value: channelId).execute()
        await loadWorkspace()
    }

    func previewInvitation(token: String) async throws -> InvitationPreview? {
        guard let client = supabase else { throw AppError.notReady }
        let rows: [InvitationPreview] = try await client
            .rpc("invitation_preview", params: ["token": token]).execute().value
        return rows.first
    }

    func acceptInvitation(token: String, workspaceName: String?) async throws {
        guard let client = supabase else { throw AppError.notReady }
        try await client.rpc("accept_invitation", params: AcceptParams(token: token, workspaceName: workspaceName)).execute()
        await loadWorkspace()
    }

    func acceptInvitation(_ invitation: PendingInvitation, workspaceName: String?) async throws {
        guard let client = supabase else { throw AppError.notReady }
        try await client.rpc("accept_invitation_by_id", params: AcceptByIdParams(invitation: invitation.id, workspaceName: workspaceName)).execute()
        await loadWorkspace()
    }
}
