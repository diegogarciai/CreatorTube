import PlanificadorCore
import SwiftUI

/// Menú de la barra superior: cambiar de canal y cerrar sesión.
struct ChannelMenu: View {
    @Environment(AppModel.self) private var model
    @State private var showingNotifications = false

    var body: some View {
        Menu {
            if model.channels.count > 1 {
                Section("Canal") {
                    ForEach(model.channels) { channel in
                        Button {
                            Task { await model.selectChannel(channel.id) }
                        } label: {
                            if channel.id == model.selectedChannelId {
                                Label(channel.name, systemImage: "checkmark")
                            } else {
                                Text(channel.name)
                            }
                        }
                    }
                }
            }
            Section {
                if let email = model.email {
                    Text(email)
                }
                if let role = model.membership?.role {
                    Text("Rol: \(role.label)")
                }
                if model.selectedChannel != nil {
                    Button {
                        showingNotifications = true
                    } label: {
                        Label("Avisos…", systemImage: "bell")
                    }
                }
                Button("Cerrar sesión", role: .destructive) {
                    Task { await model.signOut() }
                }
            }
        } label: {
            ChannelAvatar(channel: model.selectedChannel)
        }
        .accessibilityLabel("Canal y cuenta")
        .sheet(isPresented: $showingNotifications) {
            NotificationSettingsView()
        }
    }
}

struct ChannelAvatar: View {
    let channel: ChannelRow?

    var body: some View {
        AsyncImage(url: channel?.thumbnailUrl.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                Palette.accentSoft
                Text(String(channel?.name.prefix(1) ?? "?"))
                    .font(.caption.bold())
                    .foregroundStyle(Palette.accent)
            }
        }
        .frame(width: 30, height: 30)
        .clipShape(Circle())
    }
}

/// Sin canales: invitaciones pendientes, aceptar por enlace o crear un canal
/// (`NoWorkspace` y `/onboarding` en la web).
struct NoChannelView: View {
    @Environment(AppModel.self) private var model
    @State private var error: String?
    @State private var showingCreate = false
    @State private var showingAccept = false
    @State private var namingFor: PendingInvitation?
    @State private var workspaceName = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Todavía no tienes canales. Si alguien te invitó, acepta la invitación aquí.")
                        .font(.callout)
                        .foregroundStyle(Palette.muted)
                }
                if !model.pendingInvitations.isEmpty {
                    Section("Invitaciones pendientes") {
                        ForEach(model.pendingInvitations) { invitation in
                            invitationRow(invitation)
                        }
                    }
                }
                Section {
                    Button { showingAccept = true } label: { Label("Tengo un enlace de invitación", systemImage: "link") }
                    if !model.workspacesForNewChannel.isEmpty {
                        Button { showingCreate = true } label: { Label("Crear un canal", systemImage: "plus.rectangle.on.rectangle") }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(Palette.critical) }
                }
            }
            .navigationTitle("Planificador")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { ChannelMenu() }
            }
            .refreshable { await model.loadWorkspace() }
            .sheet(isPresented: $showingCreate) { CreateChannelView() }
            .sheet(isPresented: $showingAccept) { AcceptInvitationView() }
            .alert("Nombre de tu espacio", isPresented: Binding(get: { namingFor != nil }, set: { if !$0 { namingFor = nil } })) {
                TextField("Mi canal", text: $workspaceName)
                Button("Crear") {
                    if let invitation = namingFor { accept(invitation, workspaceName: workspaceName) }
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Te invitan a crear tu propio espacio, donde serás propietario.")
            }
        }
    }

    @ViewBuilder
    private func invitationRow(_ invitation: PendingInvitation) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(invitation.workspaceName ?? "Tu propio espacio")
                    .font(.body.weight(.semibold))
                if let role = invitation.role {
                    Text(role.label).font(.caption).foregroundStyle(Palette.muted)
                }
            }
            Spacer()
            Button(invitation.kind == "workspace" ? "Aceptar" : "Crear espacio") {
                if invitation.kind == "workspace" {
                    accept(invitation, workspaceName: nil)
                } else {
                    workspaceName = ""
                    namingFor = invitation
                }
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func accept(_ invitation: PendingInvitation, workspaceName: String?) {
        Task {
            do {
                try await model.acceptInvitation(invitation, workspaceName: workspaceName?.trimmingCharacters(in: .whitespaces))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
