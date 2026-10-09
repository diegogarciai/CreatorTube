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
