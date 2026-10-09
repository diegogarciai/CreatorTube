import SwiftUI

/// Pestaña «Más»: lo que en la web está en la barra lateral.
struct MoreView: View {
    @Environment(AppModel.self) private var model
    @State private var showingNotifications = false

    var body: some View {
        List {
            Section {
                NavigationLink {
                    AllChannelsView()
                } label: {
                    Label("Todos mis canales", systemImage: "square.grid.2x2")
                }
                NavigationLink {
                    EpisodeSearchView()
                } label: {
                    Label("Buscar episodios", systemImage: "magnifyingglass")
                }
            }

            Section(model.selectedChannel?.name ?? "Canal") {
                NavigationLink {
                    AnalyticsView()
                } label: {
                    Label("Analítica", systemImage: "chart.bar.xaxis")
                }
                NavigationLink {
                    TasksView()
                } label: {
                    Label("Tareas en curso", systemImage: "gearshape.2")
                }
                NavigationLink {
                    ChannelSettingsView()
                } label: {
                    Label("Configuración del canal", systemImage: "slider.horizontal.3")
                }
            }

            Section("Espacios") {
                ForEach(model.memberships, id: \.workspaceId) { membership in
                    if let workspace = membership.workspace {
                        NavigationLink {
                            TeamView(workspace: workspace)
                        } label: {
                            LabeledContent {
                                Text(membership.role.label)
                            } label: {
                                Label(workspace.name, systemImage: "person.3")
                            }
                        }
                    }
                }
            }

            Section("Cuenta") {
                if let email = model.email {
                    LabeledContent("Correo", value: email)
                }
                if let role = model.membership?.role {
                    LabeledContent("Rol en este canal", value: role.label)
                }
                Button {
                    showingNotifications = true
                } label: {
                    Label("Avisos", systemImage: "bell")
                }
                Button("Cerrar sesión", role: .destructive) {
                    Task { await model.signOut() }
                }
            }
        }
        .sheet(isPresented: $showingNotifications) {
            NotificationSettingsView()
        }
    }
}
