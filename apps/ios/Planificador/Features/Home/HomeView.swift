import PlanificadorCore
import SwiftUI

/// Inicio: meta de la semana, racha, cobertura, alertas, próximas fechas y
/// señales (`components/home/overview.tsx`).
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var isCreating = false

    private struct Overview {
        let week: WeekCoverage
        let streak: Int
        let nextWeeks: [WeekCoverage]
        let alerts: [PlanningAlert]
        let upcoming: [UpcomingDate]
        let signals: [Signal]
    }

    private func computeOverview() -> Overview? {
        guard let channel = model.selectedChannel else { return nil }
        let episodes = model.plannedEpisodes
        let today = model.today
        let goal = channel.weeklyGoal
        let week = startOfWeek(today)
        return Overview(
            week: weekCoverage(episodes, weekStart: week, weeklyGoal: goal),
            streak: publishingStreak(episodes, today: today, weeklyGoal: goal),
            nextWeeks: [7, 14].map { weekCoverage(episodes, weekStart: addDays(week, $0), weeklyGoal: goal) },
            alerts: computeAlerts(episodes, today: today, weeklyGoal: goal, now: Date()),
            upcoming: upcomingDates(episodes, today: today),
            signals: channelSignals(episodes, today: today, weeklyGoal: goal)
        )
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let error = model.episodesError {
                    ErrorBanner(message: error) { await model.loadEpisodes() }
                }
                if model.selectedChannel?.onboardingCompletedAt == nil {
                    OnboardingCard()
                }
                if model.episodes.isEmpty && !model.isLoadingEpisodes {
                    emptyState
                } else if let overview = computeOverview() {
                    content(overview)
                }
            }
            .padding(16)
        }
        .background(Palette.background)
        .overlay {
            if model.isLoadingEpisodes && model.episodes.isEmpty { ProgressView() }
        }
        .refreshable { await model.loadEpisodes() }
        .sheet(isPresented: $isCreating) {
            EpisodeFormView(mode: .create)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("Tu semana empieza aquí")
                .font(.headline)
            Text("Crea tu primer episodio con fecha de publicación y verás la meta, la cobertura y las alertas.")
                .font(.callout)
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.muted)
            if model.can(.manageEpisodes) {
                Button("Nuevo episodio") { isCreating = true }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 8)
            }
        }
        .padding(.vertical, 48)
    }

    @ViewBuilder
    private func content(_ o: Overview) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Card(title: "Meta de la semana") {
                Text("\(o.week.planned)/\(o.week.goal)")
                    .font(.title.bold().monospacedDigit())
                ProgressBar(
                    value: o.week.ratio,
                    tint: o.week.ratio >= 1 ? Palette.ok : Palette.accent
                )
                Text(Copy.weekGoalValue(o.week))
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
            }
            Card(title: "Racha") {
                Text(Copy.streak(o.streak))
                    .font(.title3.bold())
                Image(systemName: "flame.fill")
                    .foregroundStyle(o.streak > 0 ? Palette.accent : Palette.muted)
            }
        }

        Card(title: "Cobertura") {
            ForEach(o.nextWeeks, id: \.weekStart) { cov in
                HStack {
                    Text(Copy.coverageWeek(cov.weekStart))
                    Spacer()
                    Badge(text: "\(cov.planned)/\(cov.goal)", tone: cov.missing == 0 ? .ok : .warn)
                }
                .font(.callout)
            }
        }

        Card(title: "Alertas") {
            if o.alerts.isEmpty {
                Text("Nada en riesgo. Buen trabajo.")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
            } else {
                ForEach(Array(o.alerts.enumerated()), id: \.offset) { _, alert in
                    alertRow(alert)
                }
            }
        }

        Card(title: "Próximas fechas") {
            if o.upcoming.isEmpty {
                Text("No hay fechas en los próximos 14 días.")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
            } else {
                ForEach(Array(o.upcoming.enumerated()), id: \.offset) { _, item in
                    NavigationLink(value: EpisodeRoute(id: item.episodeId)) {
                        HStack(spacing: 8) {
                            Text(formatDateKey(item.date))
                                .font(.callout.monospacedDigit())
                                .frame(width: 56, alignment: .leading)
                            Badge(text: item.kind == .publish ? "Publicar" : "Grabar",
                                  tone: item.kind == .publish ? .accent : .neutral)
                            Text(item.title)
                                .font(.callout)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            StatusBadge(status: item.status)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }

        Card(title: "Señales del canal") {
            ForEach(o.signals, id: \.kind) { signal in
                HStack {
                    Text(Copy.signalLabel(signal.kind))
                        .font(.callout)
                    Spacer()
                    Text(Copy.signalValue(signal))
                        .font(.callout.monospacedDigit().weight(.semibold))
                    Badge(text: Copy.signalLevel(signal.level), tone: signal.level.tone)
                }
            }
            Text(Copy.signalsNote)
                .font(.caption2)
                .foregroundStyle(Palette.muted)
        }
    }

    @ViewBuilder
    private func alertRow(_ alert: PlanningAlert) -> some View {
        let row = HStack(alignment: .firstTextBaseline, spacing: 8) {
            Badge(text: Copy.severity(alert.severity), tone: alert.severity.tone)
            Text(Copy.alert(alert))
                .font(.callout)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        if let id = alert.episodeId {
            NavigationLink(value: EpisodeRoute(id: id)) { row }
                .buttonStyle(.plain)
        } else {
            row
        }
    }
}
