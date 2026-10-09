import Charts
import PlanificadorCore
import SwiftUI

/// Analítica del canal (`/c/[channelId]/analitica`): «Así te fue ayer», los
/// últimos 28 días con datos frente a los 28 anteriores, vistas por día,
/// episodios publicados y videos recientes.
struct AnalyticsView: View {
    @Environment(AppModel.self) private var model
    @State private var bundle = AnalyticsBundle()
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }

            yesterdaySection

            if bundle.connected {
                periodSection
                chartSection
            } else if !isLoading {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Todavía no hay analítica del canal").font(.headline)
                        Text("Se trae una vez al día desde YouTube Analytics (con 2 o 3 días de atraso). Si el canal está conectado, pulsa «Actualizar ahora».")
                            .font(.callout)
                            .foregroundStyle(Palette.muted)
                    }
                }
            }

            episodesSection
            recentSection
        }
        .navigationTitle("Analítica")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                ServerActionButton(title: "Actualizar ahora", systemImage: "arrow.clockwise",
                                   action: { try await model.refreshAnalytics() },
                                   onDone: { await load() })
            }
        }
        .overlay { if isLoading { ProgressView() } }
        .task(id: model.selectedChannelId) { await load() }
        .refreshable { await load() }
    }

    // MARK: - Así te fue ayer

    @ViewBuilder
    private var yesterdaySection: some View {
        Section {
            if let y = bundle.yesterday {
                VStack(alignment: .leading, spacing: 8) {
                    Text(headline(y))
                        .font(.headline)
                    HStack(spacing: 12) {
                        stat("Vistas", y.views, typical: bundle.typical?.views)
                        stat("Me gusta", y.likes, typical: bundle.typical?.likes)
                        stat("Comentarios", y.comments, typical: bundle.typical?.comments)
                    }
                    Text("Del \(formatDateKey(y.fromDay)) al \(formatDateKey(y.toDay)), con los contadores públicos de tus últimos videos (aproximado). Las variaciones comparan con tu día típico: la mediana de los últimos 28 días.")
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                }
                .padding(.vertical, 4)
            } else {
                Text(bundle.hasSnapshots
                     ? "Ya hay una foto de tus contadores; las cifras de ayer aparecen mañana, después de la sincronización diaria."
                     : "Las cifras de ayer aparecen después de dos sincronizaciones diarias.")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
            }
            if let last = bundle.lastDay {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(formatDateKey(last.day, template: "EEEE d 'de' MMMM").capitalized): último día completo en YouTube Analytics")
                        .font(.caption.weight(.semibold))
                    Text("\(Int(last.views)) vistas · \(hours(last.watchMinutes)) h vistas · \(signed(last.subscribersGained - last.subscribersLost)) suscriptores")
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                }
            }
        } header: {
            Text("Así te fue ayer")
        }
    }

    private func headline(_ y: YesterdayReport) -> String {
        let summary = bundle.summary
        var text: String
        switch summary?.tone {
        case .good: text = "Buen día: \(percent(summary?.change)) más vistas que lo normal"
        case .weak: text = "Un día flojo: \(percent(summary?.change.map { -$0 })) menos vistas que lo normal"
        case .normal: text = "Un día normal: \(y.views) vistas (lo normal son \(Int((bundle.typical?.views ?? 0).rounded())))"
        case nil: text = "\(y.views) vistas en las últimas 24 horas"
        }
        if let driver = summary?.driver {
            let title = bundle.videoTitles[driver.videoId] ?? driver.videoId
            text += ", impulsado por «\(title)» (\(driver.views) vistas)"
        }
        return text
    }

    private func stat(_ label: String, _ value: Int, typical: Double?) -> some View {
        let change = compareToTypical(Double(value), typical)
        return VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(Palette.muted)
            Text("\(value)").font(.title3.bold().monospacedDigit())
            if let change {
                Text((change >= 0 ? "+" : "") + percent(change))
                    .font(.caption2)
                    .foregroundStyle(change >= 0 ? Palette.ok : Palette.critical)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - 28 días

    private var periodSection: some View {
        Section {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                tile("Vistas", "\(Int(bundle.current.views))", bundle.current.views, bundle.previous?.views)
                tile("Horas vistas", hours(bundle.current.watchMinutes), bundle.current.watchMinutes, bundle.previous?.watchMinutes)
                tile("Suscriptores netos", signed(bundle.current.subscribersNet), bundle.current.subscribersNet, bundle.previous?.subscribersNet)
                tile("Duración media", duration(bundle.current.averageViewDurationS), bundle.current.averageViewDurationS, bundle.previous?.averageViewDurationS)
                tile("% visto promedio", String(format: "%.1f %%", bundle.current.averageViewPercentage), bundle.current.averageViewPercentage, bundle.previous?.averageViewPercentage)
            }
            .padding(.vertical, 4)
        } header: {
            Text("Últimos 28 días con datos")
        } footer: {
            Text("Cifras de YouTube Analytics" + (bundle.fetchedAt.flatMap(Timestamp.parse).map { ", leídas el \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "") + ". Las variaciones comparan con los 28 días anteriores.")
        }
    }

    private func tile(_ label: String, _ value: String, _ current: Double, _ previous: Double?) -> some View {
        let change = previous.flatMap { $0 != 0 ? (current - $0) / abs($0) : nil }
        return VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(Palette.muted)
            Text(value).font(.title3.bold().monospacedDigit())
            if let change {
                Text((change >= 0 ? "▲ " : "▼ ") + percent(abs(change)))
                    .font(.caption2)
                    .foregroundStyle(change >= 0 ? Palette.ok : Palette.critical)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Palette.surfaceMuted, in: RoundedRectangle(cornerRadius: 10))
    }

    private var chartSection: some View {
        Section("Vistas por día") {
            Chart(bundle.daily, id: \.day) { day in
                BarMark(
                    x: .value("Día", CalendarBridge.date(from: day.day), unit: .day),
                    y: .value("Vistas", day.views)
                )
                .foregroundStyle(Palette.accent)
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 7)) { _ in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                }
            }
            .frame(height: 180)
            .padding(.vertical, 6)
            .accessibilityLabel("Vistas por día de los últimos 28 días")
        }
    }

    // MARK: - Episodios y videos

    @ViewBuilder
    private var episodesSection: some View {
        if !bundle.episodes.isEmpty {
            Section {
                ForEach(bundle.episodes) { item in
                    NavigationLink(value: EpisodeRoute(id: item.episode.id)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.episode.title).lineLimit(2)
                            HStack(spacing: 10) {
                                Text("7 días: \(Int(item.firstWeek.views))")
                                Text("Total: \(Int(item.total.views))")
                                Text(String(format: "%.0f %% visto", item.total.averageViewPercentage))
                                Text(duration(item.total.averageViewDurationS))
                            }
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Palette.muted)
                        }
                    }
                }
            } header: {
                Text("Episodios publicados")
            } footer: {
                Text("Cifras de YouTube por video: la primera semana (7 días desde la publicación) y el total.")
            }
        }
    }

    @ViewBuilder
    private var recentSection: some View {
        if !bundle.recent.isEmpty {
            Section("Videos recientes sincronizados") {
                ForEach(bundle.recent) { video in
                    Link(destination: URL(string: "https://www.youtube.com/watch?v=\(video.videoId)")!) {
                        HStack(spacing: 10) {
                            AsyncImage(url: video.thumbnailUrl.flatMap(URL.init(string:))) { image in
                                image.resizable().aspectRatio(16 / 9, contentMode: .fill)
                            } placeholder: {
                                Palette.surfaceMuted
                            }
                            .frame(width: 96, height: 54)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(video.title ?? video.videoId).lineLimit(2).foregroundStyle(Palette.text)
                                if let views = video.viewCount?.value {
                                    Text("\(Int(views)) vistas").font(.caption).foregroundStyle(Palette.muted)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Formato

    private func percent(_ value: Double?) -> String {
        guard let value else { return "" }
        return "\(Int((value * 100).rounded())) %"
    }

    private func hours(_ minutes: Double) -> String {
        String(format: "%.1f", minutes / 60)
    }

    private func signed(_ value: Double) -> String {
        let n = Int(value.rounded())
        return n > 0 ? "+\(n)" : "\(n)"
    }

    private func duration(_ seconds: Double) -> String {
        let s = Int(seconds.rounded())
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private func load() async {
        do {
            bundle = try await model.analyticsBundle()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
