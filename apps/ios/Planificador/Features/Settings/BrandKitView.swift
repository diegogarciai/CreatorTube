import SwiftUI
import UniformTypeIdentifiers

/// Kit de marca (`BrandKitForm` de la web): logo, colores, tipografías, estilo
/// y estilo de las miniaturas. Lo usan las miniaturas y las piezas animadas.
struct BrandKitView: View {
    @Environment(AppModel.self) private var model
    @State private var bundle = BrandBundle()
    @State private var kit = BrandKit.defaults
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var importingLogo = false
    @State private var logoWorking = false
    @State private var logoError: String?
    @State private var confirmRemoveLogo = false

    private var canEdit: Bool { model.can(.configureChannel) }
    private var mixTotal: Int { Int((kit.style.mix.dark + kit.style.mix.light + kit.style.mix.accent).rounded()) }
    private var easingValid: Bool {
        kit.style.easing.trimmingCharacters(in: .whitespaces)
            .range(of: #"^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$"#,
                   options: .regularExpression) != nil
    }
    private var fontsValid: Bool {
        BrandFonts.roles.allSatisfy { role in
            let value = kit.fonts[keyPath: role.key].trimmingCharacters(in: .whitespaces)
            return !value.isEmpty && value.count <= 60
        }
    }

    var body: some View {
        Form {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }
            if bundle.isDefault && !isLoading {
                Section {
                    Text("Valores del manual de identidad de Gartechs v3.0: guárdalos o ajústalos para este canal.")
                        .font(.callout)
                        .foregroundStyle(Palette.muted)
                }
            }

            logoSection
            previewSection

            Section("Colores") {
                ForEach(BrandColors.roles.indices, id: \.self) { index in
                    let role = BrandColors.roles[index]
                    ColorPicker(selection: colorBinding(role.key), supportsOpacity: false) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(role.label)
                            Text("\(kit.colors[keyPath: role.key]) · \(role.hint)")
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                        }
                    }
                }
            }
            .disabled(!canEdit)

            Section("Tipografías") {
                ForEach(BrandFonts.roles.indices, id: \.self) { index in
                    let role = BrandFonts.roles[index]
                    LabeledContent(role.label) {
                        TextField(role.label, text: $kit.fonts[dynamicMember: role.key])
                            .multilineTextAlignment(.trailing)
                            .autocorrectionDisabled()
                    }
                }
            }
            .disabled(!canEdit)

            styleSections
                .disabled(!canEdit)

            Section {
                TextEditor(text: $kit.thumbnailStyle)
                    .frame(minHeight: 160)
                    .disabled(!canEdit)
            } header: {
                Text("Estilo de las miniaturas")
            } footer: {
                Text("Indicaciones en texto para generar y calificar las miniaturas. \(kit.thumbnailStyle.count) de 2000 caracteres.")
            }

            if canEdit {
                Section {
                    ServerActionButton(title: "Guardar kit de marca", systemImage: "checkmark", prominent: true,
                                       action: { try await model.saveBrandKit(kit) },
                                       onDone: { await load() })
                        .disabled(mixTotal != 100 || !easingValid || !fontsValid || kit.thumbnailStyle.count > 2000)
                } footer: {
                    if mixTotal != 100 {
                        Text("El reparto de color tiene que sumar 100 % (ahora suma \(mixTotal) %).").foregroundStyle(Palette.critical)
                    } else if !easingValid {
                        Text("Escribe la curva como cubic-bezier(x1, y1, x2, y2).").foregroundStyle(Palette.critical)
                    } else if !fontsValid {
                        Text("Cada tipografía necesita un nombre de hasta 60 caracteres.").foregroundStyle(Palette.critical)
                    }
                }
            }
        }
        .navigationTitle("Kit de marca")
        .overlay { if isLoading { ProgressView() } }
        .task(id: model.selectedChannelId) { await load() }
        .refreshable { await load() }
        .fileImporter(isPresented: $importingLogo, allowedContentTypes: [.png, .svg, .webP, .jpeg]) { result in
            if case .success(let url) = result { Task { await uploadLogo(url) } }
        }
        .confirmationDialog("¿Quitar el logo del canal?", isPresented: $confirmRemoveLogo, titleVisibility: .visible) {
            Button("Quitar logo", role: .destructive) { Task { await removeLogo() } }
        }
    }

    // MARK: - Logo

    private var logoSection: some View {
        Section {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10).fill(Color(hex: kit.colors.canvas) ?? .black)
                    if let url = bundle.logoURL {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFit()
                        } placeholder: {
                            ProgressView()
                        }
                        .padding(8)
                    } else {
                        Text("Sin logo").font(.caption).foregroundStyle(.white.opacity(0.6))
                    }
                }
                .frame(width: 96, height: 64)
                if canEdit {
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            importingLogo = true
                        } label: {
                            HStack(spacing: 6) {
                                if logoWorking { ProgressView() }
                                Text(bundle.logoURL == nil ? "Subir logo" : "Cambiar logo")
                            }
                        }
                        .disabled(logoWorking)
                        if bundle.kit.logoPath != nil {
                            Button("Quitar logo", role: .destructive) { confirmRemoveLogo = true }
                                .disabled(logoWorking)
                        }
                    }
                    .buttonStyle(.borderless)
                }
            }
            if let logoError {
                Text(logoError).font(.caption).foregroundStyle(Palette.critical)
            }
        } header: {
            Text("Logo")
        } footer: {
            Text("La versión blanca del logo, para fondo oscuro: SVG o PNG con fondo transparente, hasta 10 MB. Se elige desde Archivos.")
        }
    }

    // MARK: - Vista previa

    private var previewSection: some View {
        Section("Vista previa") {
            ZStack {
                Color(hex: kit.colors.canvas) ?? .black
                RadialGradient(
                    colors: kit.style.halo.enabled
                        ? [(Color(hex: kit.colors.glow) ?? .orange).opacity(kit.style.halo.center / 100),
                           (Color(hex: kit.colors.amberDeep) ?? .orange).opacity(kit.style.halo.edge / 100),
                           .clear]
                        : [.clear],
                    center: .center, startRadius: 0, endRadius: 160
                )
                VStack(spacing: 4) {
                    (Text("Así se ve ").foregroundStyle(Color(hex: kit.colors.text) ?? .white)
                        + Text("la marca").foregroundStyle(Color(hex: kit.colors.accent) ?? .orange))
                        .font(.title2.weight(.black))
                    Text(kit.fonts.display)
                        .font(.caption)
                        .foregroundStyle(Color(hex: kit.colors.cream) ?? .white)
                }
            }
            .frame(height: 140)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .listRowInsets(EdgeInsets())
        }
    }

    // MARK: - Estilo

    @ViewBuilder
    private var styleSections: some View {
        Section {
            NumberRow(label: "Negro", value: $kit.style.mix.dark, range: 0...100)
            NumberRow(label: "Blanco y crema", value: $kit.style.mix.light, range: 0...100)
            NumberRow(label: "Naranja", value: $kit.style.mix.accent, range: 0...100)
        } header: {
            Text("Reparto de color en pantalla (%)")
        } footer: {
            Text("Suma \(mixTotal) %.").foregroundStyle(mixTotal == 100 ? Palette.muted : Palette.critical)
        }

        Section("Retícula") {
            IntRow(label: "Celda (px)", value: $kit.style.grid.size, range: 8...400)
            NumberRow(label: "Opacidad (%)", value: $kit.style.grid.opacity, range: 0...100)
            NumberRow(label: "Con datos (%)", value: $kit.style.grid.dataOpacity, range: 0...100)
        }

        Section("Halo del fondo") {
            Toggle("Halo", isOn: $kit.style.halo.enabled)
            Toggle("Se apaga con datos en pantalla", isOn: $kit.style.halo.offWithData)
            NumberRow(label: "Resplandor al centro (%)", value: $kit.style.halo.center, range: 0...100)
            NumberRow(label: "Ámbar en la caída (%)", value: $kit.style.halo.edge, range: 0...100)
        }

        Section("Movimiento y texto") {
            LabeledContent("Curva de movimiento") {
                TextField("cubic-bezier(0.2, 0, 0, 1)", text: $kit.style.easing)
                    .multilineTextAlignment(.trailing)
                    .font(.callout.monospaced())
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
            IntRow(label: "Blanco sobre naranja desde (px)", value: $kit.style.minWhiteOnAccentPx, range: 8...400)
            IntRow(label: "Texto sobre el halo desde (px)", value: $kit.style.minTextOnHaloPx, range: 8...400)
        }

        Section("Zona segura del vertical 1080 × 1920 (px)") {
            IntRow(label: "Arriba", value: $kit.style.safeZone.top, range: 0...1920)
            IntRow(label: "Abajo", value: $kit.style.safeZone.bottom, range: 0...1920)
            IntRow(label: "Izquierda", value: $kit.style.safeZone.left, range: 0...1920)
            IntRow(label: "Derecha", value: $kit.style.safeZone.right, range: 0...1920)
        }
    }

    private func colorBinding(_ key: WritableKeyPath<BrandColors, String>) -> Binding<Color> {
        Binding(
            get: { Color(hex: kit.colors[keyPath: key]) ?? .black },
            set: { kit.colors[keyPath: key] = $0.hexString.uppercased() }
        )
    }

    // MARK: - Acciones

    private func load() async {
        do {
            bundle = try await model.brandKit()
            kit = bundle.kit
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func uploadLogo(_ url: URL) async {
        logoWorking = true
        logoError = nil
        defer { logoWorking = false }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            try await model.setBrandLogo(data: data, fileExtension: url.pathExtension)
            await load()
        } catch {
            logoError = error.localizedDescription
        }
    }

    private func removeLogo() async {
        logoWorking = true
        logoError = nil
        defer { logoWorking = false }
        do {
            try await model.removeBrandLogo()
            await load()
        } catch {
            logoError = error.localizedDescription
        }
    }
}

/// Número con decimales (porcentajes), acotado.
private struct NumberRow: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>

    var body: some View {
        LabeledContent(label) {
            TextField(label, value: Binding(get: { value }, set: { value = min(max($0, range.lowerBound), range.upperBound) }),
                      format: .number)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 90)
        }
    }
}

/// Número entero (px), acotado.
private struct IntRow: View {
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>

    var body: some View {
        LabeledContent(label) {
            TextField(label, value: Binding(get: { value }, set: { value = min(max($0, range.lowerBound), range.upperBound) }),
                      format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 90)
        }
    }
}
