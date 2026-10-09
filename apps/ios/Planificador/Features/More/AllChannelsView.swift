import PlanificadorCore
import SwiftUI

/// «Todos mis canales» (`/todos`): meta, racha, alertas y próximas fechas de
/// cada canal, agrupados por espacio.
struct AllChannelsView: View {
    @Environment(AppModel.self) private var model
    @State private var episodes: [ChannelEpisodeRow] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private struct Summary {
        let channel: ChannelRow
        let coverage: WeekCoverage
        let streak: Int
        let alerts: [PlanningAlert]
        let upcoming: [UpcomingDate]
    }

    private func summary(_ channel: ChannelRow) -> Summary {
        let planned = episodes.filter { $0.channelId == channel.id }.map { $0.planned(timeZone: channel.timezone) }
        let today = localDateKey(Date(), timeZone: channel.timezone)
        let goal = channel.weeklyGoal
        return Summary(
            channel: channel,
            coverage: weekCoverage(planned, weekStart: startOfWeek(today), weeklyGoal: goal),
            streak: publishingStreak(planned, today: today, weeklyGoal: goal),
            alerts: computeAlerts(planned, today: today, weeklyGoal: goal, now: Date()),
            upcoming: upcomingDates(planned, today: today)
        )
    }

    var body: some View {
        List {
            if let errorMessage {
                ErrorBanner(message: errorMessage) { await load() }
            }
            ForEach(model.memberships, id: \.workspaceId) { membership in
                let channels = model.channels.filter { $0.workspaceId == membership.workspaceId }
                if !channels.isEmpty {
                    Section {
                        ForEach(channels) { channel in
                            channelCard(summary(channel))
                        }
                    } header: {
                        if model.memberships.count > 1 {
                            Text("Espacio «\(membership.workspace?.name ?? "")»")
                        }
                    }
                }
            }
        }
        .overlay { if isLoading && episodes.isEmpty { ProgressView() } }
        .navigationTitle("Todos mis canales")
        .task { await load() }
        .refreshable { await load() }
    }

    private func channelCard(_ s: Summary) -> some View {
        let critical = s.alerts.filter { $0.severity == .critical }.count
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Button {
                    Task { await model.selectChannel(s.channel.id) }
                } label: {
                    HStack(spacing: 8) {
                        ChannelAvatar(channel: s.channel)
                        Text(s.channel.name).font(.headline)
                    }
                }
                .buttonStyle(.plain)
                Spacer()
                Badge(text: "Meta: \(s.coverage.planned)/\(s.coverage.goal)", tone: s.coverage.missing == 0 ? .ok : .warn)
            }
            Text(Copy.streak(s.streak) + (critical > 0 ? " · \(critical) crítico\(critical == 1 ? "" : "s")" : ""))
                .font(.caption)
                .foregroundStyle(Palette.muted)
            ForEach(Array(s.alerts.prefix(3).enumerated()), id: \.offset) { _, alert in
                Text(Copy.alert(alert))
                    .font(.footnote)
                    .foregroundStyle(alert.severity == .critical ? Palette.critical : alert.severity == .warning ? Palette.warn : Palette.muted)
            }
            if !s.upcoming.isEmpty {
                Divider()
                ForEach(Array(s.upcoming.prefix(4).enumerated()), id: \.offset) { _, item in
                    NavigationLink {
                        if let episode = episodes.first(where: { $0.id == item.episodeId }) {
                            ChannelEpisodeOpener(episode: episode)
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(formatDateKey(item.date, template: "EEE d"))
                                .frame(width: 52, alignment: .leading)
                                .foregroundStyle(Palette.muted)
                            Image(systemName: item.kind == .publish ? "play.fill" : "circle.fill")
                                .font(.caption2)
                                .foregroundStyle(Palette.muted)
                            Text(item.title).lineLimit(1)
                        }
                        .font(.footnote)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        do {
            episodes = try await model.allChannelEpisodes()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

/// Búsqueda de episodios en todos los canales.
struct EpisodeSearchView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var results: [ChannelEpisodeRow] = []
    @State private var isSearching = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Palette.critical)
            }
            ForEach(results) { episode in
                NavigationLink {
                    ChannelEpisodeOpener(episode: episode)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(episode.title).lineLimit(2)
                        HStack(spacing: 6) {
                            Text("#\(episode.number)")
                            Text(model.channel(id: episode.channelId)?.name ?? "")
                            StatusBadge(status: episode.status)
                        }
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                    }
                }
            }
        }
        .overlay {
            if isSearching {
                ProgressView()
            } else if !query.isEmpty && results.isEmpty {
                ContentUnavailableView.search(text: query)
            } else if query.isEmpty {
                ContentUnavailableView("Buscar episodios", systemImage: "magnifyingglass",
                                       description: Text("Busca por título en todos tus canales."))
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Título del episodio")
        .task(id: query) {
            // Espera a que se deje de escribir antes de buscar.
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await search()
        }
        .navigationTitle("Buscar")
    }

    private func search() async {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            results = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            results = try await model.searchEpisodes(query)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Abre un episodio de cualquier canal: primero cambia al canal y luego
/// muestra la ficha.
struct ChannelEpisodeOpener: View {
    @Environment(AppModel.self) private var model
    let episode: ChannelEpisodeRow

    var body: some View {
        Group {
            if model.selectedChannelId == episode.channelId && model.episode(id: episode.id) != nil {
                EpisodeDetailView(episodeId: episode.id)
            } else {
                ProgressView()
            }
        }
        .task {
            if model.selectedChannelId != episode.channelId {
                await model.selectChannel(episode.channelId)
            }
        }
    }
}
