import PlanificadorCore
import SwiftUI
import UIKit

/// Difusión del episodio (pestaña Difusión de la web): posts para redes (3
/// cápsulas por red) y comentarios con respuesta sugerida.
struct DistributionView: View {
    @Environment(AppModel.self) private var model
    let episode: EpisodeRow

    @State private var bundle = DistributionBundle()
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var withLink = true
    @State private var commentFilter: CommentFilter = .open
    @State private var redoTarget: ChannelSocial?

    private var canPublish: Bool { model.can(.publish) }
    private var canIdea: Bool { model.can(.writeScript) }
    private var link: String? { episode.youtubeVideoId.flatMap { $0.isEmpty ? nil : videoLink($0) } }

    var body: some View {
        List {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }
            postsSections
            commentsSections
            Section {
                NavigationLink {
                    EpisodeNewsletterView(episode: episode)
                } label: {
                    Label("Boletín del episodio", systemImage: "envelope")
                }
            } footer: {
                Text("Tus apreciaciones y los comentarios que elijas; Claude lo redacta con tu voz y se envía cuando decidas.")
            }
        }
        .navigationTitle("Difusión")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if isLoading { ProgressView() } }
        .task(id: episode.id) { await load() }
        .task(id: watching) { await watch() }
        .refreshable { await load() }
        .confirmationDialog("Hay posts editados en esta red. ¿Reescribir los que no están publicados?",
                            isPresented: Binding(get: { redoTarget != nil }, set: { if !$0 { redoTarget = nil } }),
                            titleVisibility: .visible) {
            Button("Rehacer") {
                if let network = redoTarget?.network { perform { try await model.generateSocialPosts(episode.id, network: network) } }
            }
        }
    }

    // MARK: - Posts para redes

    @ViewBuilder
    private var postsSections: some View {
        Section {
            if bundle.networks.isEmpty {
                Text("El canal todavía no tiene redes." + (model.can(.configureChannel) ? " Agrégalas en Más › Configuración del canal › Redes." : ""))
                    .font(.callout).foregroundStyle(Palette.muted)
            } else if !bundle.hasScript {
                Text("Los posts salen del guion verificado: todavía no está.").font(.callout).foregroundStyle(Palette.muted)
            }
            if bundle.postsTask?.isActive == true {
                Label("Escribiendo los posts. Tarda menos de un minuto.", systemImage: "hourglass")
                    .font(.callout).foregroundStyle(Palette.warn)
            } else if bundle.postsTask?.failed == true {
                Text("No se pudieron escribir los posts." + (bundle.postsTask?.error.map { " \($0)" } ?? ""))
                    .font(.callout).foregroundStyle(Palette.critical)
            }
            if canPublish && bundle.hasScript && !bundle.networks.isEmpty && bundle.postsTask?.isActive != true
                && !missingCapsules(bundle.networks.map(\.network), existing: bundle.posts.map { ($0.network, $0.kind.rawValue) }).isEmpty {
                ServerActionButton(title: "Generar posts", systemImage: "sparkles", prominent: true,
                                   cost: DistributionCredits.socialPosts,
                                   action: { try await model.generateSocialPosts(episode.id) },
                                   onDone: { await load() })
            }
            if link != nil && !bundle.posts.isEmpty {
                Toggle("Copiar con el enlace al video (cuenta en el tope)", isOn: $withLink)
            }
            if bundle.posts.isEmpty && !bundle.networks.isEmpty && bundle.hasScript && bundle.postsTask?.isActive != true {
                Text("Todavía no hay posts para este episodio.").font(.callout).foregroundStyle(Palette.muted)
            }
        } header: {
            Text("Posts para redes")
        } footer: {
            Text("3 cápsulas por red: el dato, el mito y la postura del episodio. Se copian con el enlace al video y se marcan publicadas a mano.")
        }

        ForEach(bundle.networks, id: \.network) { network in
            let posts = bundle.posts(for: network.network)
            if !posts.isEmpty {
                Section {
                    ForEach(posts) { post in
                        SocialPostEditor(post: post, network: network, link: withLink ? link : nil, canPublish: canPublish) {
                            await load()
                        }
                    }
                    if canPublish && posts.contains(where: { $0.status != .published }) && bundle.postsTask?.isActive != true {
                        Button {
                            if posts.contains(where: { $0.status == .edited }) {
                                redoTarget = network
                            } else {
                                perform { try await model.generateSocialPosts(episode.id, network: network.network) }
                            }
                        } label: {
                            Label("Rehacer", systemImage: "arrow.clockwise")
                        }
                    }
                } header: {
                    HStack {
                        Text(network.label)
                        Spacer()
                        Text("\(posts.filter { $0.status == .published }.count) de \(posts.count) publicados")
                        if let url = URL(string: network.url), !network.url.isEmpty {
                            Link("Perfil", destination: url)
                        }
                    }
                }
            }
        }

        if !bundle.orphans.isEmpty {
            Section("Redes que ya no están en Ajustes") {
                ForEach(bundle.orphans) { post in
                    SocialPostEditor(post: post, network: ChannelSocial(network: post.network, label: networkRules(post.network).label, url: ""),
                                     link: withLink ? link : nil, canPublish: canPublish) { await load() }
                }
            }
        }
    }

    // MARK: - Comentarios

    private var shownComments: [CommentRow] {
        switch commentFilter {
        case .open: bundle.comments.filter(\.isOpen)
        case .all: bundle.comments
        case .flagged: bundle.comments.filter { !$0.flags.isEmpty }
        case .kind(let kind): bundle.comments.filter { $0.kind == kind }
        }
    }

    @ViewBuilder
    private var commentsSections: some View {
        Section {
            if episode.youtubeVideoId == nil {
                Text("El episodio todavía no tiene video de YouTube vinculado.").font(.callout).foregroundStyle(Palette.muted)
            }
            if bundle.commentsTask?.isActive == true {
                Label("Clasificando los comentarios y escribiendo las respuestas… puedes salir de esta pantalla.", systemImage: "hourglass")
                    .font(.callout).foregroundStyle(Palette.warn)
            } else if bundle.commentsTask?.failed == true {
                Text("No se pudieron clasificar los comentarios." + (bundle.commentsTask?.error.map { " \($0)" } ?? ""))
                    .font(.callout).foregroundStyle(Palette.critical)
            }
            if canPublish && episode.youtubeVideoId != nil {
                ServerActionButton(title: "Leer comentarios", systemImage: "text.bubble", prominent: true,
                                   cost: DistributionCredits.comments,
                                   action: { try await model.readComments(episode.id) },
                                   onDone: { await load() })
                    .disabled(bundle.commentsTask?.isActive == true)
                if !bundle.canPublishReplies {
                    Text("Para publicar respuestas desde la app, activa las respuestas a comentarios en Más › Configuración del canal (pide un permiso de escritura a Google).")
                        .font(.caption).foregroundStyle(Palette.muted)
                }
            }
            if !bundle.comments.isEmpty {
                Picker("Mostrar", selection: $commentFilter) {
                    Text("Por responder (\(bundle.comments.filter(\.isOpen).count))").tag(CommentFilter.open)
                    Text("Todos (\(bundle.comments.count))").tag(CommentFilter.all)
                    Text("Marcados (\(bundle.comments.filter { !$0.flags.isEmpty }.count))").tag(CommentFilter.flagged)
                    ForEach(CommentKind.allCases, id: \.self) { Text($0.filterLabel).tag(CommentFilter.kind($0)) }
                }
            }
        } header: {
            Text("Comentarios")
        } footer: {
            Text("Respuestas sugeridas como tú. Se publican en YouTube solo cuando las confirmas.")
        }

        if !bundle.comments.isEmpty {
            Section {
                if shownComments.isEmpty {
                    Text("No hay comentarios en este filtro.").foregroundStyle(Palette.muted)
                }
                ForEach(shownComments) { comment in
                    CommentCardView(comment: comment, canPublish: canPublish, canIdea: canIdea,
                                    canPublishReplies: bundle.canPublishReplies) { await load() }
                }
            }
        } else if !isLoading && episode.youtubeVideoId != nil {
            Section { Text("Todavía no se leyeron comentarios de este video.").foregroundStyle(Palette.muted) }
        }

        if let reading = bundle.reading {
            readingSection(reading)
        }
    }

    @ViewBuilder
    private func readingSection(_ reading: CommentReading) -> some View {
        Section {
            if !reading.pains.isEmpty {
                Text("Dolores").font(.subheadline.weight(.semibold))
                ForEach(Array(reading.pains.enumerated()), id: \.offset) { index, pain in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(pain.pain)
                        Text("\(pain.count) \(pain.count == 1 ? "comentario" : "comentarios") · «\(pain.quote)»")
                            .font(.caption).foregroundStyle(Palette.muted)
                        if canIdea {
                            ToIdeaButton { try await model.readingToIdea(episodeId: episode.id, index: index, kind: "pain") }
                        }
                    }
                }
            }
            if !reading.themes.isEmpty {
                Text("Temas que se repiten").font(.subheadline.weight(.semibold))
                Text(reading.themes.map { "\($0.theme) (\($0.count))" }.joined(separator: " · ")).font(.callout)
            }
            if !reading.questions.isEmpty {
                Text("Respuestas a las preguntas del video").font(.subheadline.weight(.semibold))
                ForEach(Array(reading.questions.enumerated()), id: \.offset) { _, q in
                    (Text(q.question).bold() + Text(": \(q.trend)")).font(.callout)
                }
            }
            if !reading.corrections.isEmpty {
                Text("Correcciones pendientes").font(.subheadline.weight(.semibold))
                ForEach(Array(reading.corrections.enumerated()), id: \.offset) { _, text in Text("• \(text)").font(.callout) }
            }
            if !reading.ideas.isEmpty {
                Text("Ideas para próximos videos").font(.subheadline.weight(.semibold))
                ForEach(Array(reading.ideas.enumerated()), id: \.offset) { index, idea in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(idea).font(.callout)
                        if canIdea {
                            ToIdeaButton { try await model.readingToIdea(episodeId: episode.id, index: index, kind: "idea") }
                        }
                    }
                }
            }
        } header: {
            Text("Lectura de los comentarios")
        } footer: {
            Text(reading.topPain.isEmpty ? "Lo que dice la audiencia de este episodio, acumulado entre lecturas." : reading.topPain)
        }
    }

    // MARK: - Datos

    /// Mientras hay un trabajo corriendo se revisa cada 3 s, como la web.
    private var watching: Bool { bundle.postsTask?.isActive == true || bundle.commentsTask?.isActive == true }

    private func watch() async {
        guard watching else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            let posts = await model.latestTask(kind: "social_posts", episodeId: episode.id)
            let comments = await model.latestTask(kind: "comments", episodeId: episode.id)
            if posts?.isActive != true && comments?.isActive != true {
                await load()
                return
            }
        }
    }

    private func load() async {
        do {
            bundle = try await model.distribution(episode)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func perform(_ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
                await load()
            } catch is CancellationError {
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

enum CommentFilter: Hashable {
    case open, all, flagged
    case kind(CommentKind)
}

/// «Pasar a Ideas»: crea la idea y queda marcado.
struct ToIdeaButton: View {
    let action: () async throws -> Void
    @State private var done = false

    var body: some View {
        if done {
            Label("Idea creada en Ideas.", systemImage: "checkmark").font(.caption).foregroundStyle(Palette.ok)
        } else {
            ServerActionButton(title: "Pasar a Ideas", systemImage: "lightbulb",
                               action: action, onDone: { done = true })
                .font(.caption)
        }
    }
}

/// Un post para una red: editar, copiar, marcar publicado o descartar.
struct SocialPostEditor: View {
    @Environment(AppModel.self) private var model
    let post: SocialPostRow
    let network: ChannelSocial
    let link: String?
    let canPublish: Bool
    var onChange: () async -> Void

    @State private var text = ""
    @State private var copied = false
    @State private var askingURL = false
    @State private var postURL = ""
    @State private var errorMessage: String?

    private var locked: Bool { post.status == .published || !canPublish }
    private var size: Int { postSize(network.network, text: text, link: link) }
    private var limit: Int { networkRules(network.network, label: network.label).limit }
    private var problems: [String] {
        post.status == .published || post.status == .dismissed ? [] : validatePost(network.network, text: text, link: link)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Badge(text: post.kind.label, tone: post.kind == .dato ? .accent : post.kind == .mito ? .warn : .ok)
                if post.status != .suggested {
                    Badge(text: post.status.postLabel, tone: post.status == .published ? .ok : .neutral)
                }
                Spacer()
                Text("\(size)/\(limit)").font(.caption.monospacedDigit())
                    .foregroundStyle(size > limit ? Palette.critical : Palette.muted)
            }
            if locked {
                Text(text).font(.callout)
            } else {
                TextEditor(text: $text).frame(minHeight: 110).font(.callout)
            }
            ForEach(problems, id: \.self) { Text($0).font(.caption).foregroundStyle(Palette.critical) }
            if let url = post.postUrl.flatMap(URL.init(string:)), post.status == .published {
                Link("Ver post", destination: url).font(.caption)
            }
            HStack(spacing: 14) {
                Button(copied ? "Copiado" : "Copiar") {
                    UIPasteboard.general.string = postWithLink(text, link: link)
                    copied = true
                }
                if canPublish {
                    if text != post.text && post.status != .published {
                        ServerActionButton(title: "Guardar", action: { try await model.saveSocialPost(post.id, text: text) }, onDone: onChange)
                    }
                    if post.status == .published {
                        ServerActionButton(title: "Desmarcar",
                                           action: { try await model.markSocialPostPublished(post.id, published: false) },
                                           onDone: onChange)
                    } else {
                        Button("Marcar publicado") { askingURL = true }
                        ServerActionButton(title: post.status == .dismissed ? "Recuperar" : "Descartar",
                                           action: { try await model.dismissSocialPost(post.id, dismissed: post.status != .dismissed) },
                                           onDone: onChange)
                    }
                }
            }
            .buttonStyle(.borderless)
            .font(.caption)
            if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(Palette.critical) }
        }
        .padding(.vertical, 4)
        .opacity(post.status == .dismissed ? 0.6 : 1)
        .onAppear { text = post.text }
        .onChange(of: post.text) { _, value in text = value }
        .alert("Marcar publicado", isPresented: $askingURL) {
            TextField("https://…", text: $postURL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
            Button("Marcar") { Task { await markPublished() } }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("Enlace al post en \(network.label) (opcional):")
        }
    }

    private func markPublished() async {
        do {
            if text != post.text { try await model.saveSocialPost(post.id, text: text) }
            try await model.markSocialPostPublished(post.id, published: true, url: postURL.trimmingCharacters(in: .whitespaces))
            errorMessage = nil
            await onChange()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Un comentario con su respuesta sugerida.
struct CommentCardView: View {
    @Environment(AppModel.self) private var model
    let comment: CommentRow
    let canPublish: Bool
    let canIdea: Bool
    let canPublishReplies: Bool
    var onChange: () async -> Void

    @State private var reply = ""
    @State private var copied = false

    private var tone: Tone {
        switch comment.kind {
        case .preguntaTecnica?, .pedidoTema?: .accent
        case .correccion?, .desacuerdo?: .warn
        case .elogio?: .ok
        case .trollSpam?: .critical
        default: .neutral
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(comment.authorName?.isEmpty == false ? comment.authorName! : "Anónimo").font(.subheadline.weight(.semibold))
                if let date = comment.publishedAt.flatMap(Timestamp.parse) {
                    Text(date.formatted(date: .abbreviated, time: .omitted)).font(.caption).foregroundStyle(Palette.muted)
                }
                Spacer()
                Link(destination: URL(string: commentUrl(videoId: comment.videoId, commentId: comment.commentId))!) {
                    Image(systemName: "arrow.up.right.square")
                }
                .accessibilityLabel("Ver en YouTube")
            }
            HStack(spacing: 6) {
                Badge(text: comment.kind?.label ?? "Sin clasificar", tone: tone)
                ForEach(comment.flags, id: \.self) { Badge(text: CommentFlag(rawValue: $0)?.label ?? $0, tone: .critical) }
                if comment.replyStatus == .published {
                    Badge(text: "Respondido desde la app", tone: .ok)
                } else if comment.channelReplied {
                    Badge(text: "Ya respondiste en YouTube", tone: .neutral)
                }
            }
            Text(comment.text).font(.callout)

            if let c = comment.correction {
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.valid ? "Fe de erratas sugerida (la persona tiene razón)" : "Corrección revisada: el video estaba bien")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(c.valid ? Palette.warn : Palette.muted)
                    Text("El video decía: \(c.said). Lo correcto: \(c.correct). Fuente: \(c.source). Minuto: \(c.minute).")
                        .font(.caption)
                }
                .padding(8)
                .background(Palette.surfaceMuted, in: RoundedRectangle(cornerRadius: 8))
            }
            if comment.kind == .trollSpam {
                Text("Troll o spam: mejor no responder; ocúltalo o repórtalo en YouTube.").font(.caption).foregroundStyle(Palette.muted)
            } else if !comment.flags.isEmpty && comment.reply.isEmpty {
                Text("Marcado: no se sugiere respuesta. Revísalo en YouTube antes de hacer nada.").font(.caption).foregroundStyle(Palette.muted)
            }

            replyArea

            if canIdea && comment.kind == .pedidoTema {
                ToIdeaButton { try await model.commentToIdea(comment.commentId) }
            }
        }
        .padding(.vertical, 4)
        .opacity(comment.replyStatus == .dismissed ? 0.6 : 1)
        .onAppear { reply = comment.reply }
        .onChange(of: comment.reply) { _, value in reply = value }
    }

    @ViewBuilder
    private var replyArea: some View {
        if comment.replyStatus == .published {
            Text(comment.reply).font(.callout).foregroundStyle(Palette.ok)
        } else if canPublish && !comment.channelReplied {
            VStack(alignment: .leading, spacing: 6) {
                Text("Respuesta sugerida").font(.caption).foregroundStyle(Palette.muted)
                TextEditor(text: $reply).frame(minHeight: 80).font(.callout)
                HStack(spacing: 14) {
                    ServerActionButton(title: "Publicar", systemImage: "paperplane",
                                       confirm: "Se publica esta respuesta en YouTube como el canal. ¿Continuar?",
                                       action: { try await model.publishReply(comment.commentId, text: reply.trimmingCharacters(in: .whitespacesAndNewlines)) },
                                       onDone: onChange)
                        .disabled(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || comment.replyStatus == .dismissed || !canPublishReplies)
                    if reply != comment.reply {
                        ServerActionButton(title: "Guardar",
                                           action: { try await model.saveReply(comment.commentId, text: reply.trimmingCharacters(in: .whitespacesAndNewlines)) },
                                           onDone: onChange)
                    }
                    Button(copied ? "Copiada" : "Copiar") {
                        UIPasteboard.general.string = reply
                        copied = true
                    }
                    ServerActionButton(title: comment.replyStatus == .dismissed ? "Volver a proponer" : "No responder",
                                       action: { try await model.dismissReply(comment.commentId, dismissed: comment.replyStatus != .dismissed) },
                                       onDone: onChange)
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
        } else if !comment.reply.isEmpty {
            Text(comment.reply).font(.callout).foregroundStyle(Palette.muted)
        }
    }
}
