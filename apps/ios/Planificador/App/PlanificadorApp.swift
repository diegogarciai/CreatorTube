import SwiftUI
import UserNotifications

@main
struct PlanificadorApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(Palette.accent)
                .task { await model.start() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Al volver a la app se refrescan los episodios (y con ellos los avisos).
            if phase == .active && model.phase == .signedIn && !model.channels.isEmpty {
                Task { await model.loadEpisodes() }
            }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if supabase == nil {
            ConfigMissingView()
        } else {
            switch model.phase {
            case .loading:
                LoadingView()
            case .signedOut:
                LoginView()
            case .signedIn:
                if model.channels.isEmpty {
                    if model.isLoadingWorkspace {
                        LoadingView()
                    } else if let error = model.workspaceError {
                        ErrorBanner(message: error) { await model.loadWorkspace() }
                            .padding()
                    } else {
                        NoChannelView()
                    }
                } else {
                    MainTabView()
                }
            }
        }
    }
}

/// Pestañas principales. Cada una tiene su pila de navegación hacia el
/// detalle del episodio.
struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabView {
            tab("Inicio", systemImage: "house") { HomeView() }
            tab("Ideas", systemImage: "lightbulb") { IdeasView() }
            tab("Producción", systemImage: "film.stack") { EpisodesView() }
            tab("Calendario", systemImage: "calendar") { CalendarView() }
        }
    }

    private func tab<Content: View>(_ title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content()
                .navigationTitle(title)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Text(model.selectedChannel?.name ?? "")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Palette.muted)
                            .lineLimit(1)
                    }
                    ToolbarItem(placement: .topBarTrailing) { ChannelMenu() }
                }
                .navigationDestination(for: EpisodeRoute.self) { route in
                    EpisodeDetailView(episodeId: route.id)
                }
        }
        .tabItem { Label(title, systemImage: systemImage) }
    }
}

/// Pantalla de carga con fondo propio (no negro) y el logo.
struct LoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            LogoView(size: 56)
            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
    }
}
