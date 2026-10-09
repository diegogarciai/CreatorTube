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

    var body: some View {
        List {
            Section {
                Picker("Sección", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            } footer: {
                Text("Proponer, aprobar, generar y renderizar se hace por ahora desde la web.")
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
