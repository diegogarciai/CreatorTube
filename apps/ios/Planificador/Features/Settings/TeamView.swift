import PlanificadorCore
import SwiftUI
import UIKit

/// Espacio y equipo (`/espacio/[id]`): créditos, miembros, invitar y revocar.
/// Cambiar el rol de alguien o quitarlo necesita el servidor (llega más adelante).
struct TeamView: View {
    @Environment(AppModel.self) private var model
    let workspace: WorkspaceRef

    @State private var credits: WorkspaceCredits?
    @State private var members: [MemberRow] = []
    @State private var invitations: [InvitationRow] = []
    @State private var showingInvite = false
    @State private var errorMessage: String?
    @State private var confirmLeave = false
    @State private var editingMember: MemberRow?

    private var myRole: Role? { model.memberships.first { $0.workspaceId == workspace.id }?.role }
    private var canManage: Bool { myRole.map { can($0, .manageMembers) } ?? false }

    var body: some View {
        List {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }

            if let credits, let monthly = credits.monthly {
                Section("Créditos de IA este mes") {
                    let used = credits.used?.value ?? 0
                    ProgressBar(value: monthly > 0 ? used / Double(monthly) : 0,
                                tint: used >= Double(monthly) ? Palette.critical : Palette.accent)
                        .padding(.vertical, 4)
                    LabeledContent("Usados", value: "\(Int(used.rounded())) de \(monthly)")
                    LabeledContent("Quedan", value: "\(Int((credits.remaining?.value ?? 0).rounded()))")
                }
            }

            Section("Miembros") {
                ForEach(members) { member in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.profile?.displayName ?? "Alguien") + Text(member.userId == model.userId ? " · Tú" : "").foregroundColor(Palette.muted)
                            if let email = member.profile?.email, member.profile?.fullName?.isEmpty == false {
                                Text(email).font(.caption).foregroundStyle(Palette.muted)
                            }
                            Text(channelsText(member.channelIds)).font(.caption).foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        Badge(text: member.role.label, tone: member.role == .owner ? .accent : .neutral)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if canManage && member.role != .owner && member.userId != model.userId { editingMember = member }
                    }
                }
            }

            if canManage {
                Section {
                    Button { showingInvite = true } label: { Label("Invitar al equipo", systemImage: "person.badge.plus") }
                }
                Section("Invitaciones pendientes") {
                    if invitations.isEmpty {
                        Text("No hay invitaciones pendientes.").foregroundStyle(Palette.muted)
                    }
                    ForEach(invitations) { invitation in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(invitation.email ?? "")
                                HStack(spacing: 6) {
                                    if let role = invitation.role { Text(role.label) }
                                    if let date = invitation.expiresAt.flatMap(Timestamp.parse) {
                                        Text("Vence el \(date.formatted(date: .abbreviated, time: .omitted))")
                                    }
                                }
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                            }
                            Spacer()
                            Button("Revocar", role: .destructive) { revoke(invitation) }
                                .buttonStyle(.borderless)
                        }
                    }
                }
            } else {
                Section { Text("Solo propietarios y administradores gestionan el equipo.").foregroundStyle(Palette.muted) }
            }

            if myRole != .owner {
                Section {
                    Button("Salir de este espacio", role: .destructive) { confirmLeave = true }
                }
            }
        }
        .navigationTitle(workspace.name)
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingInvite, onDismiss: { Task { await load() } }) {
            InviteView(workspace: workspace)
        }
        .sheet(item: $editingMember, onDismiss: { Task { await load() } }) { member in
            MemberEditView(workspace: workspace, member: member)
        }
        .confirmationDialog("¿Salir de «\(workspace.name)»? Dejarás de ver sus canales.", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Salir", role: .destructive) {
                Task {
                    do { try await model.leaveWorkspace(workspace.id) } catch { errorMessage = error.localizedDescription }
                }
            }
        }
    }

    private func channelsText(_ ids: [String]?) -> String {
        guard let ids, !ids.isEmpty else { return "Todos los canales" }
        let names = ids.compactMap { id in model.channels.first { $0.id == id }?.name }
        return names.isEmpty ? "\(ids.count) canales" : names.joined(separator: ", ")
    }

    private func revoke(_ invitation: InvitationRow) {
        Task {
            do { try await model.revokeInvitation(invitation); await load() }
            catch { errorMessage = error.localizedDescription }
        }
    }

    private func load() async {
        do {
            credits = await model.credits(workspaceId: workspace.id)
            members = try await model.members(workspaceId: workspace.id)
            if canManage {
                invitations = await model.pendingWorkspaceInvitations(workspaceId: workspace.id)
            } else {
                invitations = []
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct InviteView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let workspace: WorkspaceRef

    @State private var email = ""
    @State private var role: Role = .producer
    @State private var allChannels = true
    @State private var channelIds: Set<String> = []
    @State private var link: URL?
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var roles: [Role] { invitableRoles(model.memberships.first { $0.workspaceId == workspace.id }?.role) }
    private var workspaceChannels: [ChannelRow] { model.channels.filter { $0.workspaceId == workspace.id } }

    var body: some View {
        NavigationStack {
            Form {
                if let link {
                    Section {
                        Text(link.absoluteString).font(.caption.monospaced()).textSelection(.enabled)
                        Button("Copiar enlace") { UIPasteboard.general.string = link.absoluteString }
                        ShareLink(item: link) { Label("Compartir enlace", systemImage: "square.and.arrow.up") }
                    } header: {
                        Text("Enlace de invitación")
                    } footer: {
                        Text("Envíaselo a la persona invitada; la app no lo manda por correo. Vence en 14 días. Si entra sin el enlace, igual verá la invitación al iniciar sesión con ese correo.")
                    }
                } else {
                    Section {
                        TextField("Correo", text: $email)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Picker("Rol", selection: $role) {
                            ForEach(roles, id: \.self) { Text($0.label).tag($0) }
                        }
                    }
                    if workspaceChannels.count > 1 {
                        Section("Canales") {
                            Toggle("Todos los canales", isOn: $allChannels)
                            if !allChannels {
                                ForEach(workspaceChannels) { channel in
                                    Toggle(channel.name, isOn: Binding(
                                        get: { channelIds.contains(channel.id) },
                                        set: { on in if on { channelIds.insert(channel.id) } else { channelIds.remove(channel.id) } }
                                    ))
                                }
                            }
                        }
                    }
                    if let errorMessage {
                        Section { Text(errorMessage).foregroundStyle(Palette.critical) }
                    }
                }
            }
            .navigationTitle("Invitar al equipo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(link == nil ? "Cancelar" : "Listo") { dismiss() } }
                if link == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Crear invitación") { Task { await create() } }
                            .disabled(isSaving || !email.contains("@") || (!allChannels && channelIds.isEmpty))
                    }
                }
            }
        }
    }

    private func create() async {
        isSaving = true
        defer { isSaving = false }
        do {
            link = try await model.invite(
                workspaceId: workspace.id,
                email: email,
                role: role,
                channelIds: allChannels ? nil : Array(channelIds)
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Cambiar el rol y los canales de un miembro, o quitarlo (`updateMember` y
/// `removeMember`, que piden el servidor).
struct MemberEditView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let workspace: WorkspaceRef
    let member: MemberRow

    @State private var role: Role = .viewer
    @State private var allChannels = true
    @State private var channelIds: Set<String> = []

    private var roles: [Role] { invitableRoles(model.memberships.first { $0.workspaceId == workspace.id }?.role) }
    private var workspaceChannels: [ChannelRow] { model.channels.filter { $0.workspaceId == workspace.id } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Rol", selection: $role) {
                        ForEach(roles, id: \.self) { Text($0.label).tag($0) }
                    }
                }
                if workspaceChannels.count > 1 {
                    Section("Canales") {
                        Toggle("Todos los canales", isOn: $allChannels)
                        if !allChannels {
                            ForEach(workspaceChannels) { channel in
                                Toggle(channel.name, isOn: Binding(
                                    get: { channelIds.contains(channel.id) },
                                    set: { on in if on { channelIds.insert(channel.id) } else { channelIds.remove(channel.id) } }
                                ))
                            }
                        }
                    }
                }
                Section {
                    ServerActionButton(title: "Guardar cambios", systemImage: "checkmark", prominent: true,
                                       action: {
                                           try await model.updateMember(workspaceId: workspace.id, userId: member.userId, role: role,
                                                                        channelIds: allChannels ? nil : Array(channelIds))
                                       },
                                       onDone: { dismiss() })
                    ServerActionButton(title: "Quitar del espacio", systemImage: "person.badge.minus", role: .destructive,
                                       confirm: "Dejará de ver los canales de «\(workspace.name)».",
                                       action: { try await model.removeMember(workspaceId: workspace.id, userId: member.userId) },
                                       onDone: { dismiss() })
                }
            }
            .navigationTitle(member.profile?.displayName ?? "Miembro")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
            }
            .onAppear {
                role = member.role
                allChannels = member.channelIds?.isEmpty ?? true
                channelIds = Set(member.channelIds ?? [])
            }
        }
    }
}
