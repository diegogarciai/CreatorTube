import AVKit
import SwiftUI
import UIKit

/// Pestañas Producción y Publicación del episodio, en modo lectura: ayudas
/// visuales con sus videos, miniaturas, recursos para descargar y títulos.
/// Proponer, aprobar, generar y renderizar siguen en la web por ahora.
struct ProductionView: View {
    enum Tab: String, CaseIterable {
        case aids = "Ayudas"
        case thumbnails = "Miniaturas"
        case resources = "Recursos"
        case titles = "Títulos"
    }

    @Environment(AppModel.self) private var model
    let episode: EpisodeRow

    @State private var tab: Tab = .aids
    @State private var bundle = ProductionBundle()
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var pickedIdeas: [String] = []
    @State private var noteTarget: ThumbnailAssetRow?
    @State private var noteText = ""
    @State private var textTarget: ThumbnailAssetRow?
    @State private var newText = ""
    @State private var newAccent = ""
    @State private var editingAid: VisualAidRow?

    private var canWrite: Bool { model.can(.writeScript) }

    var body: some View {
        List {
            Section {
                Picker("Sección", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }

            switch tab {
            case .aids: aidsSection
            case .thumbnails: thumbnailsSection
            case .resources: resourcesSection
            case .titles: titlesSection
            }
        }
        .navigationTitle("Producción")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editingAid) { aid in
            AidEditorView(aid: aid) { await load() }
        }
        .alert("Regenerar miniatura", isPresented: Binding(get: { noteTarget != nil }, set: { if !$0 { noteTarget = nil } })) {
            TextField("Qué cambiar (opcional)", text: $noteText)
            Button("Regenerar (≈ \(CreditEstimate.thumbnails) créditos)") {
                if let target = noteTarget { perform { try await model.regenerateThumbnail(episode.id, design: target.designIdx, note: noteText) } }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("Se genera otra versión de la miniatura \(noteTarget?.letter ?? "").")
        }
        .alert("Cambiar el texto", isPresented: Binding(get: { textTarget != nil }, set: { if !$0 { textTarget = nil } })) {
            TextField("Texto (hasta 40)", text: $newText)
            TextField("Palabra en naranja", text: $newAccent)
            Button("Aplicar (≈ \(CreditEstimate.thumbnailText) créditos)") {
                if let target = textTarget {
                    let text = String(newText.trimmingCharacters(in: .whitespaces).prefix(40))
                    let accent = String(newAccent.trimmingCharacters(in: .whitespaces).prefix(40))
                    if !text.isEmpty && !accent.isEmpty {
                        perform { try await model.editThumbnailText(target.id, text: text, accent: accent, mirror: false) }
                    }
                }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("Misma imagen de fondo con otro texto.")
        }
        .overlay { if isLoading { ProgressView() } }
        .refreshable { await load() }
        .task(id: episode.id) {
            await load()
            while !Task.isCancelled && bundle.isActive {
                try? await Task.sleep(for: .seconds(5))
                await load()
            }
        }
    }

    // MARK: - Ayudas visuales

    @ViewBuilder
    private var aidsSection: some View {
        if canWrite {
            Section {
                if bundle.aids.isEmpty {
                    ServerActionButton(
                        title: "Proponer plan", systemImage: "sparkles", prominent: true,
                        cost: CreditEstimate.visualPlan,
                        action: { try await model.proposeVisualPlan(episode.id) },
                        onDone: { await load() }
                    )
                } else {
                    if bundle.aids.contains(where: { $0.status == "approved" }) {
                        ServerActionButton(
                            title: "Renderizar las aprobadas", systemImage: "film", prominent: true,
                            action: { try await model.renderApprovedAids(episode.id) },
                            onDone: { await load() }
                        )
                    }
                    ServerActionButton(
                        title: "Rehacer plan", systemImage: "arrow.clockwise",
                        cost: CreditEstimate.visualPlan,
                        confirm: "Se reemplazan las ayudas propuestas y descartadas; las aprobadas se conservan si siguen en el guion.",
                        action: { try await model.proposeVisualPlan(episode.id) },
                        onDone: { await load() }
                    )
                    if !bundle.renders.isEmpty {
                        ServerActionButton(
                            title: "Borrar renders", systemImage: "trash", role: .destructive,
                            confirm: "Se borran todos los videos renderizados de este episodio.",
                            action: { try await model.deleteRenders(episode.id) },
                            onDone: { await load() }
                        )
                    }
                    ServerActionButton(
                        title: "Borrar plan", systemImage: "trash", role: .destructive,
                        confirm: "Se borra el plan de ayudas visuales. Si hay renders, primero hay que borrarlos.",
                        action: { try await model.deletePlan(episode.id) },
                        onDone: { await load() }
                    )
                }
            } footer: {
                Text("El plan sale del guion verificado: motion graphics (M), etiquetas de concepto (C) y listas (L). Aprueba las que se hacen y renderízalas.")
            }
        }
        if bundle.aids.isEmpty {
            Section { Text("Todavía no hay plan de ayudas visuales.").foregroundStyle(Palette.muted) }
        } else {
            ForEach(bundle.aids) { aid in
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(aid.code).font(.caption.monospaced().bold())
                            Text(aid.kindLabel).font(.caption).foregroundStyle(Palette.muted)
                            Spacer()
                            Badge(text: aid.statusLabel, tone: aid.statusTone)
                        }
                        Text(aid.title).font(.headline)
                        Text("«\(aid.anchor)»").font(.caption).italic().foregroundStyle(Palette.muted)
                        if let idea = aid.idea, !idea.isEmpty { Text(idea).font(.callout) }
                        if let definition = aid.definition, !definition.isEmpty { Text(definition).font(.callout) }
                        if let seconds = aid.durationS {
                            Text("\(seconds) s").font(.caption).foregroundStyle(Palette.muted)
                        }
                        if canWrite {
                            HStack(spacing: 16) {
                                if aid.status != "approved" {
                                    ServerActionButton(title: "Aprobar", systemImage: "checkmark.circle",
                                                       action: { try await model.setAidStatus(aid.id, "approved") },
                                                       onDone: { await load() })
                                }
                                if aid.status != "discarded" {
                                    ServerActionButton(title: "Descartar", systemImage: "xmark.circle",
                                                       action: { try await model.setAidStatus(aid.id, "discarded") },
                                                       onDone: { await load() })
                                }
                                if aid.status != "proposed" {
                                    ServerActionButton(title: "Volver a propuesta", systemImage: "arrow.uturn.backward",
                                                       action: { try await model.setAidStatus(aid.id, "proposed") },
                                                       onDone: { await load() })
                                }
                            }
                            .font(.caption)
                            Button {
                                editingAid = aid
                            } label: {
                                Label("Editar textos", systemImage: "pencil")
                            }
                            .buttonStyle(.borderless)
                            .font(.caption)
                            if aid.status == "approved" && !bundle.renders(for: aid).isEmpty {
                                ServerActionButton(title: "Renderizar de nuevo", systemImage: "film",
                                                   action: { try await model.renderAid(aid.id) },
                                                   onDone: { await load() })
                                    .font(.caption)
                            }
                        }
                    }
                    ForEach(bundle.renders(for: aid)) { render in
                        renderRow(render, aid: aid)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func renderRow(_ render: AidRenderRow, aid: VisualAidRow) -> some View {
        if render.status == "ready", let path = render.path, let url = bundle.urls[path] {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(render.formatLabel).font(.subheadline.weight(.medium))
                    Spacer()
                    DownloadShareButton(url: url, fileName: "\(episode.code ?? "EP")-\(aid.code)-\(render.format).\(render.fileExtension)")
                }
                if render.format == "horizontal" || render.format == "vertical" {
                    VideoPlayer(player: AVPlayer(url: url))
                        .aspectRatio(render.format == "vertical" ? 9 / 16 : 16 / 9, contentMode: .fit)
                        .frame(maxHeight: 320)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        } else {
            HStack {
                Text(render.formatLabel)
                Spacer()
                Badge(text: render.status == "rendering" ? "Renderizando" : RunStatusLabel.label(render.status), tone: RunStatusLabel.tone(render.status))
            }
        }
    }

    // MARK: - Miniaturas

    @ViewBuilder
    private var thumbnailsSection: some View {
        let designs = Dictionary(grouping: bundle.thumbnails, by: \.designIdx).sorted { $0.key < $1.key }
        ideasSection
        PhotoGridView(
            title: "Fotos del producto",
            footer: "Fotos reales del producto para las miniaturas que lo muestran.",
            max: episodeRefsMax,
            canEdit: model.can(.writeScript),
            load: { try await model.episodeRefs(episode.id) },
            add: { try await model.addEpisodeRef(episode.id, data: $0, label: nil) },
            delete: { try await model.deleteEpisodeRef($0) }
        )
        if designs.isEmpty {
            Section { Text("Todavía no hay miniaturas.").foregroundStyle(Palette.muted) }
        } else {
            ForEach(designs, id: \.key) { idx, versions in
                Section("Miniatura \(versions.first?.letter ?? "\(idx + 1)")") {
                    ForEach(versions) { version in
                        thumbnailRow(version)
                    }
                }
            }
        }
    }

    /// Textos para las miniaturas: proponer 30 y elegir 3 de esquemas distintos.
    @ViewBuilder
    private var ideasSection: some View {
        if canWrite {
            Section {
                if bundle.ideas.isEmpty {
                    ServerActionButton(
                        title: "Proponer 30 textos", systemImage: "sparkles", prominent: true,
                        cost: CreditEstimate.thumbnailIdeas,
                        action: { try await model.proposeThumbnailIdeas(episode.id) },
                        onDone: { await load() }
                    )
                } else {
                    ForEach(bundle.ideas) { idea in
                        let index = pickedIdeas.firstIndex(of: idea.id)
                        Button {
                            togglePick(idea)
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                ZStack {
                                    Circle().stroke(index != nil ? Palette.accent : Palette.border, lineWidth: 2)
                                    if let index {
                                        Text(["A", "B", "C"][index]).font(.caption.bold()).foregroundStyle(Palette.accent)
                                    }
                                }
                                .frame(width: 24, height: 24)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(idea.text).font(.callout.weight(.semibold)).foregroundStyle(Palette.text)
                                    Text(idea.title).font(.caption).foregroundStyle(Palette.muted).lineLimit(2)
                                    HStack(spacing: 6) {
                                        Text(idea.schemeLabel)
                                        Text(idea.hasFace ? "Con cara" : "Sin cara")
                                        if let slot = idea.slot { Text("En la tarjeta \(["A", "B", "C"][min(slot, 2)])") }
                                    }
                                    .font(.caption2)
                                    .foregroundStyle(Palette.muted)
                                }
                            }
                        }
                    }
                    if pickedIdeas.count == 3 {
                        ServerActionButton(
                            title: "Generar miniaturas con estas 3", systemImage: "photo.stack", prominent: true,
                            cost: CreditEstimate.thumbnails,
                            action: { try await model.generateFromIdeas(episode.id, ideaIds: pickedIdeas) },
                            onDone: { pickedIdeas = []; await load() }
                        )
                    }
                    ServerActionButton(
                        title: "Rehacer los textos", systemImage: "arrow.clockwise",
                        cost: CreditEstimate.thumbnailIdeas,
                        confirm: "Se reemplaza la lista; los textos que están en las tarjetas se conservan.",
                        action: { try await model.proposeThumbnailIdeas(episode.id) },
                        onDone: { await load() }
                    )
                }
            } header: {
                Text("Textos para las miniaturas" + (bundle.ideas.isEmpty ? "" : " · \(pickedIdeas.count) de 3 elegidos"))
            } footer: {
                Text("Marca 3 de esquemas distintos, al menos uno con cara y uno sin cara, y genera sus miniaturas. Hace falta el guion con su Publicación y las fotos del presentador.")
            }
        }
    }

    private func togglePick(_ idea: ThumbnailIdeaRow) {
        if let i = pickedIdeas.firstIndex(of: idea.id) {
            pickedIdeas.remove(at: i)
        } else if pickedIdeas.count < 3 {
            pickedIdeas.append(idea.id)
        }
    }

    @ViewBuilder
    private func thumbnailRow(_ version: ThumbnailAssetRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let path = version.path, let url = bundle.urls[path] {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(16 / 9, contentMode: .fit)
                } placeholder: {
                    Rectangle().fill(Palette.surfaceMuted).aspectRatio(16 / 9, contentMode: .fit)
                }
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            HStack(spacing: 6) {
                if version.chosen { Badge(text: "Elegida", tone: .ok) }
                Badge(text: version.statusLabel, tone: version.status == "ready" ? .ok : version.status == "failed" ? .critical : .accent)
                if let score = version.score?.score {
                    Badge(text: "Nota \(score)/10", tone: score >= 7 ? .ok : score >= 5 ? .warn : .critical)
                }
                Spacer()
                if version.status == "ready", let path = version.path, let url = bundle.urls[path] {
                    DownloadShareButton(url: url, fileName: "\(episode.code ?? "EP")-\(version.letter)-\(version.id.prefix(6)).jpg")
                }
            }
            if let lines = version.text?.lines, !lines.isEmpty {
                Text(lines.joined(separator: " ")).font(.caption.weight(.semibold))
            }
            if let improve = version.score?.improve, !improve.isEmpty {
                Text(improve).font(.caption).foregroundStyle(Palette.muted)
            }
            if let error = version.error, version.status == "failed" {
                Text(error).font(.caption).foregroundStyle(Palette.critical)
            }
            if canWrite && version.status == "ready" {
                HStack(spacing: 16) {
                    if !version.chosen {
                        ServerActionButton(title: "Elegir", systemImage: "star",
                                           action: { try await model.chooseThumbnail(version.id) },
                                           onDone: { await load() })
                    }
                    Button { noteText = ""; noteTarget = version } label: { Label("Regenerar", systemImage: "arrow.clockwise") }
                        .buttonStyle(.borderless)
                    Button {
                        newText = version.text?.lines?.joined(separator: " ") ?? ""
                        newAccent = version.text?.accent ?? ""
                        textTarget = version
                    } label: { Label("Cambiar texto", systemImage: "textformat") }
                        .buttonStyle(.borderless)
                }
                .font(.caption)
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Recursos

    @ViewBuilder
    private var resourcesSection: some View {
        let chosen = bundle.thumbnails.filter { $0.chosen && $0.status == "ready" }
        let ready = bundle.renders.filter { $0.status == "ready" }
        if chosen.isEmpty && ready.isEmpty {
            Section { Text("Todavía no hay recursos listos: renders aprobados y miniaturas elegidas.").foregroundStyle(Palette.muted) }
        } else {
            Section("Para el editor") {
                ForEach(chosen) { version in
                    if let path = version.path, let url = bundle.urls[path] {
                        resourceRow("Miniatura \(version.letter)", detail: "JPG", url: url,
                                    fileName: "\(episode.code ?? "EP")-\(version.letter).jpg")
                    }
                }
                ForEach(ready) { render in
                    if let path = render.path, let url = bundle.urls[path],
                       let aid = bundle.aids.first(where: { $0.id == render.visualAidId }) {
                        resourceRow("\(aid.code) · \(aid.title)", detail: render.formatLabel, url: url,
                                    fileName: "\(episode.code ?? "EP")-\(aid.code)-\(render.format).\(render.fileExtension)")
                    }
                }
            }
        }
    }

    private func resourceRow(_ title: String, detail: String, url: URL, fileName: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lineLimit(2)
                Text(detail).font(.caption).foregroundStyle(Palette.muted)
            }
            Spacer()
            DownloadShareButton(url: url, fileName: fileName)
        }
    }

    // MARK: - Títulos

    @ViewBuilder
    private var titlesSection: some View {
        if bundle.titles.isEmpty {
            Section { Text("Los títulos salen de la Publicación del guion y de las miniaturas elegidas.").foregroundStyle(Palette.muted) }
        } else {
            Section("Títulos propuestos") {
                ForEach(bundle.titles) { option in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(option.title).textSelection(.enabled)
                            HStack(spacing: 6) {
                                Text(option.source)
                                Text("\(option.title.count) caracteres")
                                    .foregroundStyle(option.title.count > 70 ? Palette.warn : Palette.muted)
                            }
                            .font(.caption)
                            .foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        Button {
                            UIPasteboard.general.string = option.title
                        } label: {
                            Image(systemName: "doc.on.doc")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Copiar título")
                    }
                }
            }
        }
    }

    private func perform(_ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func load() async {
        do {
            bundle = try await model.productionBundle(episode: episode)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

/// Descarga el archivo a una carpeta temporal y abre la hoja de compartir
/// (guardar en Fotos o Archivos, AirDrop, etc.).
struct DownloadShareButton: View {
    let url: URL
    let fileName: String

    @State private var isDownloading = false
    @State private var localFile: ShareFile?

    var body: some View {
        Button {
            Task { await download() }
        } label: {
            if isDownloading {
                ProgressView()
            } else {
                Image(systemName: "square.and.arrow.down")
            }
        }
        .buttonStyle(.borderless)
        .disabled(isDownloading)
        .accessibilityLabel("Descargar \(fileName)")
        .sheet(item: $localFile) { file in
            ActivityView(items: [file.url])
        }
    }

    private func download() async {
        isDownloading = true
        defer { isDownloading = false }
        guard let result = try? await URLSession.shared.download(from: url) else { return }
        let temp = result.0
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try? FileManager.default.removeItem(at: destination)
        guard (try? FileManager.default.moveItem(at: temp, to: destination)) != nil else { return }
        localFile = ShareFile(url: destination)
    }
}

struct ShareFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
