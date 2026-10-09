import PlanificadorCore
import SwiftUI
import UIKit

/// Crear un canal sin conectarlo a YouTube (`/onboarding`, opción manual).
struct CreateChannelView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var workspaceId = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nombre del canal", text: $name)
                    if model.workspacesForNewChannel.count > 1 {
                        Picker("Espacio", selection: $workspaceId) {
                            ForEach(model.workspacesForNewChannel, id: \.id) { Text($0.name).tag($0.id) }
                        }
                    }
                } footer: {
                    Text("Se crea sin YouTube, con los pasos de checklist de siempre. Puedes conectarlo después en Configuración del canal.")
                }
                Section {
                    ServerActionButton(title: "Crear desde mi canal de YouTube", systemImage: "play.rectangle",
                                       action: { try await model.connectYouTube(workspaceId: workspaceId) },
                                       onDone: { dismiss() })
                        .disabled(workspaceId.isEmpty)
                } footer: {
                    Text("Se abre Google para que elijas la cuenta dueña del canal. Toma el nombre y la foto del canal y trae sus videos.")
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Palette.critical) }
                }
            }
            .navigationTitle("Nuevo canal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Crear") { Task { await create() } }
                        .disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty || name.count > 120 || workspaceId.isEmpty)
                }
            }
            .onAppear { if workspaceId.isEmpty { workspaceId = model.workspacesForNewChannel.first?.id ?? "" } }
        }
    }

    private func create() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await model.createChannel(workspaceId: workspaceId, name: name.trimmingCharacters(in: .whitespaces))
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Aceptar una invitación pegando su enlace (`/invite/[token]`).
struct AcceptInvitationView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var preview: InvitationPreview?
    @State private var workspaceName = ""
    @State private var isWorking = false
    @State private var errorMessage: String?

    private var token: String { invitationToken(from: link) }
    private var needsWorkspaceName: Bool { preview?.kind == "platform" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Enlace de invitación", text: $link, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: link) { _, _ in preview = nil }
                    if preview == nil {
                        Button("Revisar invitación") { Task { await check() } }
                            .disabled(token.isEmpty || isWorking)
                    }
                }
                if let preview {
                    Section {
                        if preview.expired == true {
                            Text("La invitación venció. Pide una nueva.").foregroundStyle(Palette.critical)
                        } else if preview.accepted == true {
                            Text("Esta invitación ya se usó.").foregroundStyle(Palette.warn)
                        } else if needsWorkspaceName {
                            Text("Te invitan a crear tu propio espacio en Planificador.")
                            TextField("Nombre de tu espacio", text: $workspaceName)
                        } else {
                            Text("Te invitan a «\(preview.workspaceName ?? "")»\(preview.role.map { " como \($0.label.lowercased())" } ?? "").")
                        }
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Palette.critical) }
                }
            }
            .navigationTitle("Aceptar invitación")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Aceptar") { Task { await accept() } }
                        .disabled(isWorking || preview == nil || preview?.expired == true || preview?.accepted == true
                                  || (needsWorkspaceName && workspaceName.trimmingCharacters(in: .whitespaces).isEmpty))
                }
            }
            .onAppear {
                if link.isEmpty, let clip = UIPasteboard.general.string, clip.contains("/invite/") { link = clip }
            }
        }
    }

    private func check() async {
        isWorking = true
        defer { isWorking = false }
        do {
            preview = try await model.previewInvitation(token: token)
            errorMessage = preview == nil ? "No encontramos esa invitación." : nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func accept() async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await model.acceptInvitation(token: token, workspaceName: needsWorkspaceName ? workspaceName.trimmingCharacters(in: .whitespaces) : nil)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Aviso en Inicio mientras el canal no termina su configuración (`/onboarding/canal`).
struct OnboardingCard: View {
    @Environment(AppModel.self) private var model
    @State private var errorMessage: String?

    var body: some View {
        Card(title: "Configuración pendiente") {
            Text("Revisa el perfil y el ritmo del canal y márcalo como listo. Conectar YouTube se hace desde la web.")
                .font(.callout)
            if model.can(.configureChannel) {
                HStack {
                    NavigationLink("Revisar configuración") { ChannelSettingsView() }
                        .buttonStyle(.bordered)
                    Button("Marcar como listo") {
                        Task {
                            do { try await model.completeOnboarding() } catch { errorMessage = error.localizedDescription }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(Palette.critical)
            }
        }
    }
}
