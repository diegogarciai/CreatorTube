import Foundation

/// Roles del espacio de trabajo (`workspace_role` en la base).
public enum Role: String, CaseIterable, Codable, Sendable {
    case owner
    case admin
    case producer
    case writer
    case videoEditor = "video_editor"
    case viewer

    public var label: String {
        switch self {
        case .owner: return "Propietario"
        case .admin: return "Administrador"
        case .producer: return "Productor"
        case .writer: return "Guionista"
        case .videoEditor: return "Editor de video"
        case .viewer: return "Lector"
        }
    }
}

/// Permisos (`packages/core/src/permissions.ts`, igual que `role_has_permission` en SQL).
public enum Permission: String, CaseIterable, Sendable {
    case read
    case comment
    case writeScript = "write_script"
    case manageEpisodes = "manage_episodes"
    case editVideo = "edit_video"
    case publish
    case configureChannel = "configure_channel"
    case manageMembers = "manage_members"
    case manageWorkspace = "manage_workspace"
}

private let rolePermissions: [Role: Set<Permission>] = [
    .owner: Set(Permission.allCases),
    .admin: Set(Permission.allCases).subtracting([.manageWorkspace]),
    .producer: [.read, .comment, .writeScript, .manageEpisodes, .editVideo, .publish],
    .writer: [.read, .comment, .writeScript],
    .videoEditor: [.read, .comment, .editVideo],
    .viewer: [.read, .comment],
]

public func can(_ role: Role, _ permission: Permission) -> Bool {
    rolePermissions[role]?.contains(permission) ?? false
}

/// Permiso sobre un canal concreto. `channelIds == nil` significa todos los
/// canales del espacio.
public func canOnChannel(role: Role, channelIds: [String]?, channelId: String, _ permission: Permission) -> Bool {
    if let channelIds, !channelIds.contains(where: { $0.lowercased() == channelId.lowercased() }) {
        return false
    }
    return can(role, permission)
}

/// Quién puede mover un episodio de un estado a otro. El editor de video solo
/// puede pasar de "Por grabar" a "En edición" (y devolverlo); el guionista y el
/// lector no mueven episodios. La base lo vuelve a comprobar con un trigger.
public func canChangeStatus(_ role: Role, from: EpisodeStatus, to: EpisodeStatus) -> Bool {
    if from == to { return true }
    if can(role, .manageEpisodes) { return true }
    if can(role, .editVideo) {
        return (from == .toRecord && to == .editing) || (from == .editing && to == .toRecord)
    }
    return false
}
