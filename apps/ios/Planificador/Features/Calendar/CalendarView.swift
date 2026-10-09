import PlanificadorCore
import SwiftUI
import UIKit

/// Calendario del mes (`components/calendar/month-calendar.tsx`) adaptado al
/// teléfono: la cuadrícula marca los días con puntos y, al tocar un día, se
/// listan sus episodios debajo.
struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @State private var month: DateKey?
    @State private var selectedDay: DateKey?
    @State private var isCreating = false
    @State private var rescheduling: RescheduleTarget?
    @Environment(\.openURL) private var openURL

    private static let weekdays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
    /// Estados en los que todavía se muestra la fecha de grabación.
    private static let recordStatuses: Set<EpisodeStatus> = [.planned, .script, .toRecord]

    private struct Entry: Hashable {
        enum Kind { case publish, record }
        let kind: Kind
        let episode: EpisodeRow
    }

    private func entries() -> [DateKey: [Entry]] {
        var byDay: [DateKey: [Entry]] = [:]
        for episode in model.episodes {
            if let d = episode.publishDate {
                byDay[d, default: []].append(Entry(kind: .publish, episode: episode))
            }
            if let d = episode.recordDate, Self.recordStatuses.contains(episode.status) {
                byDay[d, default: []].append(Entry(kind: .record, episode: episode))
            }
        }
        return byDay
    }

    var body: some View {
        let today = model.today
        let currentMonth = month ?? startOfMonth(today)
        let byDay = entries()
        let unscheduled = model.episodes.filter { $0.publishDate == nil && $0.status != .published }

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(currentMonth, today: today)
                grid(currentMonth, today: today, byDay: byDay)
                dayDetail(byDay: byDay, today: today)
                unscheduledSection(unscheduled)
            }
            .padding(16)
        }
        .background(Palette.background)
        .refreshable { await model.loadEpisodes() }
        .sheet(isPresented: $isCreating) {
            EpisodeFormView(mode: .create, initialPublishDate: selectedDay ?? today)
        }
        .sheet(item: $rescheduling) { target in
            RescheduleSheet(target: target)
                .presentationDetents([.medium, .large])
        }
        .toolbar {
            if let url = model.selectedChannel?.icsURL {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            if let webcal = URL(string: url.absoluteString.replacingOccurrences(of: "https://", with: "webcal://")
                                .replacingOccurrences(of: "http://", with: "webcal://")) {
                                openURL(webcal)
                            }
                        } label: {
                            Label("Suscribirse en Calendario", systemImage: "calendar.badge.plus")
                        }
                        Button {
                            UIPasteboard.general.string = url.absoluteString
                        } label: {
                            Label("Copiar enlace ICS", systemImage: "doc.on.doc")
                        }
                    } label: {
                        Image(systemName: "calendar.badge.plus")
                    }
                    .accessibilityLabel("Suscribirse al calendario")
                }
            }
        }
    }

    /// Menú para cambiar o quitar fechas (como arrastrar en el calendario web).
    @ViewBuilder
    private func dateMenu(_ episode: EpisodeRow) -> some View {
        if model.can(.manageEpisodes) {
            Button {
                rescheduling = RescheduleTarget(episode: episode, field: .publish)
            } label: {
                Label("Cambiar fecha de publicación", systemImage: "play.fill")
            }
            Button {
                rescheduling = RescheduleTarget(episode: episode, field: .record)
            } label: {
                Label("Cambiar fecha de grabación", systemImage: "circle.fill")
            }
        }
    }

    private func header(_ current: DateKey, today: DateKey) -> some View {
        HStack {
            Text(formatDateKey(current, template: "LLLL yyyy").capitalized)
                .font(.title2.bold())
            Spacer()
            Button { month = addMonths(current, -1) } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Mes anterior")
            Button("Hoy") {
                month = startOfMonth(today)
                selectedDay = today
            }
            Button { month = addMonths(current, 1) } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Mes siguiente")
        }
        .buttonStyle(.bordered)
    }

    private func grid(_ current: DateKey, today: DateKey, byDay: [DateKey: [Entry]]) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        let days = monthGrid(current).flatMap { $0 }
        let monthPrefix = String(current.prefix(7))
        return LazyVGrid(columns: columns, spacing: 4) {
            ForEach(Self.weekdays, id: \.self) { name in
                Text(name)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Palette.muted)
            }
            ForEach(days, id: \.self) { day in
                dayCell(day, inMonth: day.hasPrefix(monthPrefix), isToday: day == today, entries: byDay[day] ?? [])
            }
        }
    }

    private func dayCell(_ day: DateKey, inMonth: Bool, isToday: Bool, entries: [Entry]) -> some View {
        let isSelected = day == selectedDay
        return Button {
            selectedDay = day
        } label: {
            VStack(spacing: 4) {
                Text("\(dayOfMonth(day))")
                    .font(.callout.weight(isToday ? .bold : .regular).monospacedDigit())
                    .foregroundStyle(isToday ? Palette.accent : inMonth ? Palette.text : Palette.muted.opacity(0.6))
                HStack(spacing: 2) {
                    ForEach(Array(entries.prefix(3).enumerated()), id: \.offset) { _, entry in
                        Circle()
                            .strokeBorder(entry.episode.status.tone.foreground, lineWidth: entry.kind == .record ? 1.5 : 0)
                            .background(Circle().fill(entry.kind == .publish ? entry.episode.status.tone.foreground : .clear))
                            .frame(width: 6, height: 6)
                    }
                }
                .frame(height: 6)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(isSelected ? Palette.accentSoft : Palette.surface, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(isSelected ? Palette.accent : Palette.border))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(formatDateKey(day, template: "d 'de' MMMM")), \(entries.count) episodios")
    }

    @ViewBuilder
    private func dayDetail(byDay: [DateKey: [Entry]], today: DateKey) -> some View {
        let day = selectedDay ?? today
        let items = byDay[day] ?? []
        Card(title: formatDateKey(day, template: "EEEE d 'de' MMMM").capitalized) {
            if items.isEmpty {
                Text("Nada para este día.")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
            } else {
                ForEach(items, id: \.self) { entry in
                    NavigationLink(value: EpisodeRoute(id: entry.episode.id)) {
                        HStack(spacing: 8) {
                            Badge(text: entry.kind == .publish ? "Publicar" : "Grabar",
                                  tone: entry.kind == .publish ? .accent : .neutral)
                            Text(entry.episode.title)
                                .font(.callout)
                                .lineLimit(2)
                            Spacer(minLength: 4)
                            StatusBadge(status: entry.episode.status)
                        }
                    }
                    .buttonStyle(.plain)
                    .contextMenu { dateMenu(entry.episode) }
                }
            }
            if model.can(.manageEpisodes) {
                Button {
                    selectedDay = day
                    isCreating = true
                } label: {
                    Label("Nuevo episodio este día", systemImage: "plus")
                        .font(.callout.weight(.semibold))
                }
                .padding(.top, 4)
            }
        }
    }

    private func unscheduledSection(_ episodes: [EpisodeRow]) -> some View {
        Card(title: "Sin fecha") {
            if episodes.isEmpty {
                Text("Todos los episodios tienen fecha.")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
            } else {
                ForEach(episodes) { episode in
                    NavigationLink(value: EpisodeRoute(id: episode.id)) {
                        HStack {
                            Text(episode.title)
                                .font(.callout)
                                .lineLimit(1)
                            Spacer()
                            StatusBadge(status: episode.status)
                        }
                    }
                    .buttonStyle(.plain)
                    .contextMenu { dateMenu(episode) }
                }
            }
            if model.can(.manageEpisodes) && !episodes.isEmpty {
                Text("Mantén pulsado un episodio para cambiar sus fechas.")
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
            }
        }
    }
}

struct RescheduleTarget: Identifiable {
    let episode: EpisodeRow
    let field: AppModel.DateField

    var id: String { "\(episode.id)-\(field.rawValue)" }
}

/// Elegir o quitar la fecha de publicación o grabación de un episodio.
struct RescheduleSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let target: RescheduleTarget

    @State private var date = Date()
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var current: DateKey? {
        target.field == .publish ? target.episode.publishDate : target.episode.recordDate
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(target.episode.title).font(.headline)
                    DatePicker(
                        target.field == .publish ? "Publicación" : "Grabación",
                        selection: $date,
                        displayedComponents: .date
                    )
                    .datePickerStyle(.graphical)
                    .environment(\.locale, Locale(identifier: "es"))
                }
                if current != nil {
                    Section {
                        Button("Quitar fecha", role: .destructive) { save(nil) }
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Palette.critical) }
                }
            }
            .navigationTitle(target.field == .publish ? "Fecha de publicación" : "Fecha de grabación")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") { save(CalendarBridge.dateKey(from: date)) }
                        .disabled(isSaving)
                }
            }
            .onAppear {
                if let current { date = CalendarBridge.date(from: current) }
            }
        }
    }

    private func save(_ key: DateKey?) {
        Task {
            isSaving = true
            defer { isSaving = false }
            do {
                try await model.reschedule(target.episode, field: target.field, to: key)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
