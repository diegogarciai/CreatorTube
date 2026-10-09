import PlanificadorCore
import SwiftUI

/// Menú de la barra superior: cambiar de canal y cerrar sesión.
struct ChannelMenu: View {
    @Environment(AppModel.self) private var model

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
                Button("Cerrar sesión", role: .destructive) {
                    Task { await model.signOut() }
                }
            }
        } label: {
            ChannelAvatar(channel: model.selectedChannel)
        }
        .accessibilityLabel("Canal y cuenta")
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

/// Sin canales: lista las invitaciones pendientes (`NoWorkspace` en la web).
struct NoChannelView: View {
    @Environment(AppModel.self) private var model
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Todavía no tienes canales. Si alguien te invitó a un espacio, acepta la invitación aquí. Para crear y conectar un canal, usa la versión web.")
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
                if let error {
                    Section { Text(error).foregroundStyle(Palette.critical) }
                }
            }
            .navigationTitle("Planificador")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { ChannelMenu() }
            }
            .refreshable { await model.loadWorkspace() }
        }
    }

    @ViewBuilder
    private func invitationRow(_ invitation: PendingInvitation) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(invitation.workspaceName ?? "Nuevo espacio")
                    .font(.body.weight(.semibold))
                if let role = invitation.role {
                    Text(role.label).font(.caption).foregroundStyle(Palette.muted)
                }
            }
            Spacer()
            if invitation.kind == "workspace" {
                Button("Aceptar") {
                    Task {
                        do { try await model.acceptInvitation(invitation) } catch { self.error = error.localizedDescription }
                    }
                }
                .buttonStyle(.borderedProminent)
            } else {
                Text("Acéptala en la web")
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
            }
        }
    }
}
