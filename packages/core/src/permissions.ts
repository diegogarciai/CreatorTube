/**
 * Roles dentro de un espacio de trabajo y lo que cada uno puede hacer.
 * La misma matriz vive en SQL (`public.role_has_permission`) para las reglas
 * de Row Level Security; `packages/db/test` verifica que ambas coincidan.
 */

export const ROLES = ["owner", "admin", "producer", "writer", "video_editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  /** Ver todo lo del canal. */
  "read",
  /** Comentar sin cambiar nada. */
  "comment",
  /** Trabajar ideas y guiones (preguntas de dirección, guion, verificación). */
  "write_script",
  /** Crear, mover y editar episodios; checklists; calendario. */
  "manage_episodes",
  /** Marcar un episodio como "En edición" o "grabado" y descargar recursos. */
  "edit_video",
  /** Enviar boletines, publicar, responder comentarios. */
  "publish",
  /** Configurar el canal, sus integraciones, pilares y checklists. */
  "configure_channel",
  /** Invitar y quitar miembros. */
  "manage_members",
  /** Facturación, borrar el espacio y desconectar canales. */
  "manage_workspace",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: [
    "read",
    "comment",
    "write_script",
    "manage_episodes",
    "edit_video",
    "publish",
    "configure_channel",
    "manage_members",
  ],
  producer: ["read", "comment", "write_script", "manage_episodes", "edit_video", "publish"],
  writer: ["read", "comment", "write_script"],
  video_editor: ["read", "comment", "edit_video"],
  viewer: ["read", "comment"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}

export interface MembershipScope {
  role: Role;
  /** `null` = acceso a todos los canales del espacio. */
  channelIds: string[] | null;
}

export function canOnChannel(
  membership: MembershipScope,
  channelId: string,
  permission: Permission,
): boolean {
  if (membership.channelIds !== null && !membership.channelIds.includes(channelId)) {
    return false;
  }
  return can(membership.role, permission);
}

/** Roles que una persona con `role` puede asignar al invitar. */
export function assignableRoles(role: Role): Role[] {
  if (role === "owner") return [...ROLES];
  if (role === "admin") return ROLES.filter((r) => r !== "owner");
  return [];
}
