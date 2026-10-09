import PlanificadorCore
import SwiftUI
import UIKit

/// Guía del guionista (`WriterGuide` de la web): la versión actual con sus
/// secciones y qué etapas del guion recibe cada una, las versiones anteriores y
/// publicar una nueva pegando el texto completo.
struct WriterGuideView: View {
    @Environment(AppModel.self) private var model
    @State private var bundle = WriterGuideBundle()
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var publishing = false

    private var canEdit: Bool { model.can(.configureChannel) }

    var body: some View {
        List {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }

            if let current = bundle.current {
                Section {
                    VersionLine(version: current)
                } header: {
                    Text("Versión actual")
                }
                Section {
                    ForEach(current.sections ?? [], id: \.key) { section in
                        SectionLine(key: section.key, title: section.title, stages: stagesBySection(current.stages)[section.key] ?? [])
                    }
                } header: {
                    Text("Secciones")
                } footer: {
                    Text("Cada etapa del guion recibe solo las secciones que usa.")
                }
            } else if !isLoading {
                Section {
                    Text("Todavía no hay guía. Pega el texto de tus reglas para crear la versión 1.")
                        .foregroundStyle(Palette.muted)
                }
            }

            if canEdit {
                Section {
                    Button {
                        publishing = true
                    } label: {
                        Label(bundle.current == nil ? "Crear la guía" : "Subir versión nueva", systemImage: "square.and.arrow.up")
                    }
                }
            }

            if bundle.versions.count > 1 {
                Section("Versiones anteriores") {
                    ForEach(bundle.versions.filter { $0.id != bundle.current?.id }) { VersionLine(version: $0) }
                }
            }
        }
        .navigationTitle("Guía del guionista")
        .overlay { if isLoading { ProgressView() } }
        .task(id: model.selectedChannelId) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $publishing) {
            PublishGuideView(stages: bundle.current?.stages ?? defaultStageSections) { await load() }
        }
    }

    private func load() async {
        do {
            bundle = try await model.writerGuide()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct VersionLine: View {
    let version: GuideVersionRow

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Versión \(version.version)").font(.subheadline.weight(.semibold))
            Text([Timestamp.parse(version.createdAt)?.formatted(date: .abbreviated, time: .shortened), version.author?.displayName]
                .compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(Palette.muted)
            if let notes = version.notes, !notes.isEmpty {
                Text(notes).font(.caption).foregroundStyle(Palette.muted)
            }
        }
    }
}

private struct SectionLine: View {
    let key: String
    let title: String
    let stages: [GuideStage]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(key).font(.caption.monospacedDigit()).foregroundStyle(Palette.muted)
                Text(title).font(.subheadline)
            }
            if stages.isEmpty {
                Text("Ninguna etapa (referencia)").font(.caption).foregroundStyle(Palette.muted)
            } else {
                Text(stages.map(\.label).joined(separator: " · ")).font(.caption).foregroundStyle(Palette.accent)
            }
        }
    }
}

/// Pegar el texto de la guía: se revisa mientras se escribe (las mismas reglas
/// que la web) y se publica como versión nueva.
private struct PublishGuideView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let stages: StageSections
    var onDone: () async -> Void

    @State private var content = ""
    @State private var notes = ""

    private var parsed: ParsedGuide? {
        content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : parseGuide(content)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $content)
                        .font(.caption.monospaced())
                        .frame(minHeight: 220)
                    Button {
                        if let text = UIPasteboard.general.string { content = text }
                    } label: {
                        Label("Pegar del portapapeles", systemImage: "doc.on.clipboard")
                    }
                } header: {
                    Text("Texto completo de la guía")
                } footer: {
                    Text("Pega el paquete de reglas tal cual, con sus secciones numeradas (0. PRIORIDADES, 1. ROL…).")
                }

                if let parsed {
                    let check = validateGuide(parsed, stages: stages)
                    Section {
                        if check.ok {
                            Text("\(parsed.sections.count) \(parsed.sections.count == 1 ? "sección detectada" : "secciones detectadas"). Todo listo para publicar.")
                                .foregroundStyle(Palette.ok)
                        } else if parsed.sections.isEmpty {
                            Text("No encontramos secciones numeradas en el texto (por ejemplo «0. PRIORIDADES»).")
                                .foregroundStyle(Palette.critical)
                        } else {
                            Text("Faltan secciones que usan las etapas del guion: \(check.missing.joined(separator: ", ")). Revisa que cada sección empiece con su número y el título en mayúsculas.")
                                .foregroundStyle(Palette.critical)
                        }
                        if !parsed.sections.isEmpty {
                            DisclosureGroup("Ver las secciones detectadas") {
                                let by = stagesBySection(stages)
                                ForEach(parsed.sections, id: \.key) { section in
                                    SectionLine(key: section.key, title: section.title, stages: by[section.key] ?? [])
                                }
                            }
                        }
                    }
                }

                Section {
                    TextField("Por ejemplo: v4.1 · reglas de miniaturas", text: $notes, axis: .vertical)
                } header: {
                    Text("Qué cambió en esta versión")
                }

                Section {
                    ServerActionButton(title: "Publicar versión", systemImage: "checkmark", prominent: true,
                                       action: {
                                           try await model.publishWriterGuide(
                                               content: content.trimmingCharacters(in: .whitespacesAndNewlines),
                                               notes: String(notes.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
                                           )
                                       },
                                       onDone: {
                                           await onDone()
                                           dismiss()
                                       })
                        .disabled(!(parsed.map { validateGuide($0, stages: stages).ok } ?? false))
                } footer: {
                    Text("Los próximos guiones usan la versión nueva.")
                }
            }
            .navigationTitle("Versión nueva")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
            }
        }
    }
}
