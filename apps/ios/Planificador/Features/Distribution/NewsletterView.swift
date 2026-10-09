import PlanificadorCore
import SwiftUI

/// Boletín semanal (`/c/[id]/boletin`): Claude lo redacta con los videos que
/// eliges; lo revisas, te mandas una prueba y lo envías o lo programas.
struct NewsletterView: View {
    @Environment(AppModel.self) private var model
    @State private var bundle = NewsletterBundle()
    @State private var picked: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var confirmRedo = false

    private var canPublish: Bool { model.can(.publish) }
    private var current: NewsletterRow? { bundle.current }
    private var drafting: Bool { bundle.task?.isActive == true }
    private var canDraft: Bool { canPublish && (current == nil || current?.status == "draft") }

    var body: some View {
        List {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }
            Section {
                Text("Uno por semana: Claude lo redacta con lo publicado; lo revisas, te mandas una prueba y lo envías o lo programas.")
                    .font(.callout).foregroundStyle(Palette.muted)
                if canPublish && !bundle.settings.missing.isEmpty {
                    Text("Para enviar falta: \(bundle.settings.missing.joined(separator: ", ")). Complétalo en Más › Configuración del canal › Boletín.")
                        .font(.caption).foregroundStyle(Palette.warn)
                }
                if drafting {
                    Label("Claude está redactando el boletín. Tarda uno o dos minutos.", systemImage: "hourglass")
                        .font(.callout).foregroundStyle(Palette.warn)
                } else if bundle.task?.failed == true {
                    Text("No se pudo redactar el boletín." + (bundle.task?.error.map { " \($0)" } ?? ""))
                        .font(.callout).foregroundStyle(Palette.critical)
                }
            }

            if canDraft {
                Section {
                    if bundle.candidates.isEmpty {
                        Text("No hay episodios publicados en los últimos 30 días. El boletín sale de lo publicado.")
                            .font(.callout).foregroundStyle(Palette.muted)
                    }
                    ForEach(bundle.candidates) { episode in
                        Toggle(isOn: Binding(
                            get: { picked.contains(episode.id) },
                            set: { on in
                                if on { if picked.count < newsletterMaxEpisodes { picked.append(episode.id) } }
                                else { picked.removeAll { $0 == episode.id } }
                            }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(episode.title).lineLimit(2)
                                if let date = episode.publishedAt.flatMap(Timestamp.parse) {
                                    Text(date.formatted(date: .abbreviated, time: .omitted)).font(.caption).foregroundStyle(Palette.muted)
                                }
                            }
                        }
                        .disabled(drafting)
                    }
                    if !bundle.candidates.isEmpty {
                        Button {
                            if current?.hasContent == true { confirmRedo = true } else { draft() }
                        } label: {
                            Label(current?.hasContent == true ? "Rehacer el borrador" : "Redactar el boletín", systemImage: "sparkles")
                        }
                        .disabled(drafting || picked.isEmpty)
                    }
                } header: {
                    Text("Videos de esta semana (hasta \(newsletterMaxEpisodes))")
                } footer: {
                    Text("Unos \(NewsletterCredits.draft) créditos.")
                }
            }

            if let current, current.hasContent {
                NewsletterEditorSections(newsletter: current, settings: bundle.settings, canPublish: canPublish) { await load() }
            } else if !isLoading && !canDraft {
                Section { Text("Sin boletín para esta semana.").foregroundStyle(Palette.muted) }
            }

            Section("Boletines") {
                if bundle.newsletters.isEmpty {
                    Text("Todavía no hay boletines.").foregroundStyle(Palette.muted)
                }
                ForEach(bundle.newsletters) { newsletter in
                    NavigationLink {
                        NewsletterDetailView(newsletter: newsletter, settings: bundle.settings)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(newsletter.kind == "episode"
                                     ? (newsletter.episode?.title ?? "Episodio")
                                     : "Semana del \(formatDateKey(String((newsletter.weekStart ?? "").prefix(10))))")
                                    .lineLimit(1)
                                if newsletter.hasContent {
                                    Text(newsletter.subject).font(.caption).foregroundStyle(Palette.muted).lineLimit(1)
                                }
                            }
                            Spacer()
                            Badge(text: newsletter.statusLabel, tone: newsletter.effectiveStatus == "sent" ? .ok : newsletter.effectiveStatus == "scheduled" ? .accent : .neutral)
                        }
                    }
                }
            }
        }
        .navigationTitle("Boletín \(bundle.settings.name)")
        .overlay { if isLoading { ProgressView() } }
        .task(id: model.selectedChannelId) { await load() }
        .task(id: drafting) { await watch() }
        .refreshable { await load() }
        .confirmationDialog("Se reescribe el borrador de esta semana y se pierde lo que editaste. ¿Seguir?",
                            isPresented: $confirmRedo, titleVisibility: .visible) {
            Button("Rehacer el borrador", role: .destructive) { draft() }
        }
    }

    private func draft() {
        Task {
            do {
                try await model.draftNewsletter(episodeIds: picked)
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func load() async {
        do {
            bundle = try await model.newsletters()
            picked = bundle.initialPicks
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func watch() async {
        guard drafting else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            let bundle = try? await model.newsletters()
            if bundle?.task?.isActive != true {
                await load()
                return
            }
        }
    }
}

/// Un boletín del historial.
struct NewsletterDetailView: View {
    @Environment(AppModel.self) private var model
    let newsletter: NewsletterRow
    let settings: NewsletterSettings
    @State private var current: NewsletterRow?

    var body: some View {
        List {
            NewsletterEditorSections(newsletter: current ?? newsletter, settings: settings, canPublish: model.can(.publish)) {
                let bundle = try? await model.newsletters()
                current = bundle?.newsletters.first { $0.id == newsletter.id }
            }
        }
        .navigationTitle(newsletter.kind == "episode" ? "Boletín del episodio" : "Boletín semanal")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Boletín de un episodio: tus apreciaciones (opcional) y los comentarios que
/// eliges; Claude lo redacta con tu voz.
struct EpisodeNewsletterView: View {
    @Environment(AppModel.self) private var model
    let episode: EpisodeRow
    @State private var bundle = EpisodeNewsletterBundle()
    @State private var notes = ""
    @State private var picked: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var confirmRedo = false

    private var canPublish: Bool { model.can(.publish) }
    private var drafting: Bool { bundle.task?.isActive == true }
    private var locked: Bool { bundle.newsletter.map { $0.status != "draft" } ?? false }

    var body: some View {
        List {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }
            if canPublish && !locked {
                Section {
                    TextEditor(text: $notes).frame(minHeight: 110).disabled(drafting)
                } header: {
                    Text("Tus apreciaciones")
                } footer: {
                    Text("Opcional: lo que quieres decir de este episodio con tus palabras. Claude lo desarrolla con tu voz.")
                }
                Section {
                    if bundle.candidates.isEmpty {
                        Text("Todavía no hay comentarios leídos de este video.").font(.callout).foregroundStyle(Palette.muted)
                    }
                    ForEach(bundle.candidates, id: \.id) { comment in
                        Toggle(isOn: Binding(
                            get: { picked.contains(comment.id) },
                            set: { on in
                                if on { if picked.count < newsletterMaxComments { picked.append(comment.id) } }
                                else { picked.removeAll { $0 == comment.id } }
                            }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(comment.text).font(.callout).lineLimit(3)
                                HStack(spacing: 6) {
                                    if let kind = comment.kind { Badge(text: kind.label, tone: .neutral) }
                                    Label("\(comment.likes)", systemImage: "hand.thumbsup").font(.caption2).foregroundStyle(Palette.muted)
                                }
                            }
                        }
                        .disabled(drafting)
                    }
                } header: {
                    Text("Comentarios importantes (\(picked.count) de \(newsletterMaxComments))")
                }
                Section {
                    if drafting {
                        Label("Redactando…", systemImage: "hourglass").foregroundStyle(Palette.warn)
                    } else if bundle.task?.failed == true {
                        Text("No se pudo redactar el boletín." + (bundle.task?.error.map { " \($0)" } ?? ""))
                            .font(.callout).foregroundStyle(Palette.critical)
                    }
                    Button {
                        if bundle.newsletter?.hasContent == true { confirmRedo = true } else { draft() }
                    } label: {
                        Label(bundle.newsletter?.hasContent == true ? "Rehacer el borrador" : "Redactar el boletín", systemImage: "sparkles")
                    }
                    .disabled(drafting)
                } footer: {
                    Text("Unos \(NewsletterCredits.draft) créditos.")
                }
            } else if bundle.newsletter == nil && !isLoading {
                Section { Text("Este episodio todavía no tiene boletín.").foregroundStyle(Palette.muted) }
            }

            if let newsletter = bundle.newsletter, newsletter.hasContent {
                NewsletterEditorSections(newsletter: newsletter, settings: bundle.settings, canPublish: canPublish) { await load() }
            }
        }
        .navigationTitle("Boletín del episodio")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if isLoading { ProgressView() } }
        .task(id: episode.id) { await load() }
        .task(id: drafting) { await watch() }
        .confirmationDialog("Se reescribe el borrador y se pierde lo que editaste. ¿Seguir?",
                            isPresented: $confirmRedo, titleVisibility: .visible) {
            Button("Rehacer el borrador", role: .destructive) { draft() }
        }
    }

    private func draft() {
        Task {
            do {
                try await model.draftEpisodeNewsletter(episode.id, notes: notes.trimmingCharacters(in: .whitespacesAndNewlines), commentIds: picked)
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func load() async {
        do {
            bundle = try await model.episodeNewsletter(episode.id)
            notes = bundle.newsletter?.notes ?? notes
            picked = bundle.selected
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func watch() async {
        guard drafting else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            let task = await model.latestTask(kind: "newsletter", episodeId: episode.id)
            if task?.isActive != true {
                await load()
                return
            }
        }
    }
}

/// Editar, probar y enviar un boletín (`NewsletterEditor` de la web).
struct NewsletterEditorSections: View {
    @Environment(AppModel.self) private var model
    let newsletter: NewsletterRow
    let settings: NewsletterSettings
    let canPublish: Bool
    var onChange: () async -> Void

    @State private var draft = NewsletterDraft(subject: "", preheader: "", body: "", ctaText: "", point: "")
    @State private var ctaUrl = ""
    @State private var scheduling = false
    @State private var scheduleDate = Date().addingTimeInterval(3600)
    @State private var loadedId: String?

    private var locked: Bool { newsletter.status != "draft" || !canPublish }
    private var issues: [String] { validateNewsletter(draft) }
    private var changed: Bool { draft != newsletter.draft || ctaUrl != (newsletter.ctaUrl ?? "") }

    var body: some View {
        Group {
            if newsletter.effectiveStatus == "scheduled", let at = newsletter.scheduledAt.flatMap(Timestamp.parse) {
                Section { Text("Programado para el \(at.formatted(date: .abbreviated, time: .shortened)). Si necesitas cancelarlo, hazlo en Resend › Broadcasts.").font(.callout) }
            } else if newsletter.effectiveStatus == "sent" {
                let at = (newsletter.sentAt ?? newsletter.scheduledAt).flatMap(Timestamp.parse)
                Section { Text("Enviado el \(at?.formatted(date: .abbreviated, time: .shortened) ?? "—").").font(.callout) }
            }

            Section("Asunto") {
                field($draft.subject, locked: locked, limit: NewsletterLimits.subject)
            }
            Section("Preheader (vista previa en la bandeja)") {
                field($draft.preheader, locked: locked, limit: NewsletterLimits.preheader)
            }
            Section("El punto") {
                field($draft.point, locked: locked, limit: NewsletterLimits.point)
            }
            Section {
                if locked {
                    Text(draft.body).font(.callout)
                } else {
                    TextEditor(text: $draft.body).frame(minHeight: 260).font(.callout)
                }
            } header: {
                Text("Cuerpo (\(newsletterWords(draft.body)) palabras)")
            } footer: {
                Text("Markdown sencillo: párrafos separados por una línea en blanco, ## subtítulos, listas con -, **negrita**, *cursiva* y [enlaces](https://…).")
            }
            Section("Botón") {
                field($draft.ctaText, locked: locked, limit: nil)
                if locked {
                    Text(ctaUrl).font(.caption).foregroundStyle(Palette.muted)
                } else {
                    TextField("Enlace del botón", text: $ctaUrl)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
            }

            if !locked {
                Section {
                    ForEach(issues, id: \.self) { Text($0).font(.caption).foregroundStyle(Palette.critical) }
                    if changed {
                        ServerActionButton(title: "Guardar", systemImage: "tray.and.arrow.down",
                                           action: { try await model.saveNewsletter(newsletter.id, draft: draft, ctaUrl: ctaUrl.trimmingCharacters(in: .whitespaces)) },
                                           onDone: onChange)
                    }
                    ServerActionButton(title: "Enviarme una prueba", systemImage: "envelope.badge",
                                       action: {
                                           if changed { try await model.saveNewsletter(newsletter.id, draft: draft, ctaUrl: ctaUrl.trimmingCharacters(in: .whitespaces)) }
                                           try await model.sendNewsletterTest(newsletter.id)
                                       },
                                       onDone: onChange)
                    if let tested = newsletter.testSentAt.flatMap(Timestamp.parse) {
                        Text("Última prueba: \(tested.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(Palette.muted)
                    }
                    ServerActionButton(title: "Enviar ahora", systemImage: "paperplane", prominent: true,
                                       confirm: "«\(draft.subject)» sale a todo el segmento de Resend. Después de enviarlo ya no se puede editar." + (newsletter.testSentAt == nil ? " Todavía no te mandaste una prueba." : ""),
                                       action: {
                                           if changed { try await model.saveNewsletter(newsletter.id, draft: draft, ctaUrl: ctaUrl.trimmingCharacters(in: .whitespaces)) }
                                           try await model.sendNewsletter(newsletter.id, scheduledAt: nil)
                                       },
                                       onDone: onChange)
                        .disabled(!issues.isEmpty || !settings.missing.isEmpty)
                    Button {
                        scheduling = true
                    } label: {
                        Label("Programar", systemImage: "calendar.badge.clock")
                    }
                    .disabled(!issues.isEmpty || !settings.missing.isEmpty)
                } footer: {
                    if !settings.missing.isEmpty {
                        Text("Para enviar falta: \(settings.missing.joined(separator: ", ")).")
                    }
                }
            }
        }
        .onAppear(perform: fill)
        .onChange(of: newsletter) { _, _ in fill() }
        .sheet(isPresented: $scheduling) {
            NavigationStack {
                Form {
                    DatePicker("Fecha y hora", selection: $scheduleDate,
                               in: Date().addingTimeInterval(6 * 60)...Date().addingTimeInterval(30 * 86_400))
                    Section {
                        ServerActionButton(title: "Programar", systemImage: "calendar.badge.clock", prominent: true,
                                           action: {
                                               if changed { try await model.saveNewsletter(newsletter.id, draft: draft, ctaUrl: ctaUrl.trimmingCharacters(in: .whitespaces)) }
                                               try await model.sendNewsletter(newsletter.id, scheduledAt: scheduleDate)
                                           },
                                           onDone: {
                                               scheduling = false
                                               await onChange()
                                           })
                    } footer: {
                        Text("«\(draft.subject)» sale a todo el segmento de Resend. Después de programarlo ya no se puede editar.")
                    }
                }
                .navigationTitle("Programar el boletín")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { scheduling = false } } }
            }
            .presentationDetents([.medium])
        }
    }

    @ViewBuilder
    private func field(_ text: Binding<String>, locked: Bool, limit: Int?) -> some View {
        if locked {
            Text(text.wrappedValue)
        } else {
            TextField("", text: text, axis: .vertical)
            if let limit {
                let count = text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.count
                Text("\(count)/\(limit)").font(.caption2.monospacedDigit())
                    .foregroundStyle(count > limit ? Palette.critical : Palette.muted)
            }
        }
    }

    private func fill() {
        guard loadedId != newsletter.id || !changed else { return }
        draft = newsletter.draft
        ctaUrl = newsletter.ctaUrl ?? ""
        loadedId = newsletter.id
    }
}
