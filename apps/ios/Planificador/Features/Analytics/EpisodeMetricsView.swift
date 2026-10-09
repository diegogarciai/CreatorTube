import Charts
import PlanificadorCore
import SwiftUI

/// Pestaña Métricas del episodio: vistas por día y retención con las caídas
/// mayores ubicadas en los párrafos del guion.
struct EpisodeMetricsView: View {
    @Environment(AppModel.self) private var model
    let episode: EpisodeRow

    @State private var metrics = EpisodeMetrics()
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }
            if let t = metrics.totals {
                Section("Totales en YouTube") {
                    LabeledContent("Vistas", value: "\(Int(t.views))")
                    LabeledContent("Horas vistas", value: String(format: "%.1f", t.watchMinutes / 60))
                    LabeledContent("% visto promedio", value: String(format: "%.1f %%", t.averageViewPercentage))
                    LabeledContent("Me gusta", value: "\(Int(t.likes))")
                    LabeledContent("Comentarios", value: "\(Int(t.comments))")
                }
                Section("Vistas por día") {
                    Chart(metrics.daily, id: \.day) { day in
                        BarMark(x: .value("Día", CalendarBridge.date(from: day.day), unit: .day),
                                y: .value("Vistas", day.views))
                            .foregroundStyle(Palette.accent)
                    }
                    .frame(height: 160)
                    .padding(.vertical, 6)
                }
            } else if !isLoading {
                Section {
                    Text(episode.youtubeVideoId == nil
                         ? "Vincula el video de YouTube para ver sus métricas."
                         : "Todavía no hay analítica de este video. Se trae una vez al día.")
                        .foregroundStyle(Palette.muted)
                }
            }

            if !metrics.retention.isEmpty {
                Section {
                    Chart(metrics.retention, id: \.r) { point in
                        LineMark(x: .value("Video", point.r * 100), y: .value("Retención", point.watch * 100))
                            .foregroundStyle(Palette.accent)
                    }
                    .chartXAxisLabel("% del video")
                    .chartYAxisLabel("% de la audiencia")
                    .frame(height: 180)
                    .padding(.vertical, 6)
                } header: {
                    Text("Retención")
                }
            }

            if !metrics.paragraphs.isEmpty {
                Section {
                    ForEach(metrics.paragraphs, id: \.index) { p in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Párrafo \(p.index + 1)").font(.caption.weight(.semibold))
                                if p.top { Badge(text: "Caída mayor", tone: .critical) }
                                Spacer()
                                Text("\(Int((p.start * 100).rounded())) % → \(Int((p.end * 100).rounded())) %")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(p.top ? Palette.critical : Palette.muted)
                            }
                            Text(p.text).font(.callout).lineLimit(p.top ? nil : 3)
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Dónde se va la audiencia")
                } footer: {
                    Text("El video se reparte entre los párrafos del guion \(metrics.scriptSource == "fix" ? "verificado" : "") según sus palabras; es una aproximación.")
                }
            }
        }
        .navigationTitle("Métricas")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if isLoading { ProgressView() } }
        .task(id: episode.id) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            metrics = try await model.episodeMetrics(episode)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

/// Tareas largas del canal (bandeja de tareas de la web): IA, renders, importación.
struct TasksView: View {
    @Environment(AppModel.self) private var model
    @State private var tasks: [TaskRow] = []
    @State private var isLoading = true

    var body: some View {
        List {
            ForEach(tasks) { task in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(task.kindLabel)
                        Spacer()
                        Badge(text: RunStatusLabel.label(task.status), tone: RunStatusLabel.tone(task.status))
                    }
                    if task.isActive {
                        ProgressView(value: task.progress ?? 0)
                    }
                    if let message = task.message, !message.isEmpty, task.isActive {
                        Text(message).font(.caption).foregroundStyle(Palette.muted)
                    }
                    if let error = task.error, task.status == "failed" {
                        Text(error).font(.caption).foregroundStyle(Palette.critical)
                    }
                    if let episodeId = task.episodeId, let episode = model.episode(id: episodeId) {
                        NavigationLink(value: EpisodeRoute(id: episodeId)) {
                            Text(episode.title).font(.caption)
                        }
                    }
                    if let date = Timestamp.parse(task.createdAt) {
                        Text(date, format: .relative(presentation: .named))
                            .font(.caption2)
                            .foregroundStyle(Palette.muted)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .overlay {
            if isLoading {
                ProgressView()
            } else if tasks.isEmpty {
                ContentUnavailableView("Sin tareas", systemImage: "gearshape.2",
                                       description: Text("Aquí aparecen el guion, las miniaturas y los renders mientras se generan."))
            }
        }
        .navigationTitle("Tareas")
        .refreshable { await load() }
        .task(id: model.selectedChannelId) {
            await load()
            while !Task.isCancelled && tasks.contains(where: \.isActive) {
                try? await Task.sleep(for: .seconds(5))
                await load()
            }
        }
    }

    private func load() async {
        tasks = (try? await model.recentTasks()) ?? tasks
        isLoading = false
    }
}
