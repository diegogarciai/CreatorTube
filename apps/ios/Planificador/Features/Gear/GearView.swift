import PhotosUI
import PlanificadorCore
import SwiftUI
import UIKit

/// «Mi equipo» (`/c/[id]/equipo` en la web): los dispositivos del canal,
/// propios o de marcas. Claude los tiene en cuenta para proponer episodios.
struct GearView: View {
    @Environment(AppModel.self) private var model
    @State private var bundle = GearBundle()
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var onlyNoVideo = false
    @State private var editing: GearRow?
    @State private var showingAdd = false
    @State private var showingPaste = false
    @State private var deleting: GearRow?

    private var canEdit: Bool { model.can(.manageEpisodes) }
    private var parsing: Bool { bundle.task?.isActive == true }

    var body: some View {
        List {
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(Palette.critical) }
            }
            if parsing {
                Section {
                    Label("Claude está ordenando la lista. En unos segundos aparece para revisar.", systemImage: "hourglass")
                        .foregroundStyle(Palette.warn)
                }
            } else if bundle.task?.failed == true {
                Section {
                    Text("No se pudo ordenar la lista. Inténtalo de nuevo.").foregroundStyle(Palette.critical)
                }
            }

            if !bundle.review.isEmpty {
                Section {
                    ForEach(bundle.review) { row($0) }
                } header: {
                    Text("Por revisar (\(bundle.review.count))")
                } footer: {
                    Text("Revisa marca, modelo y categoría, completa lo que falte (origen, fecha, foto) y confírmalos.")
                }
            }

            let allActive = bundle.active
            if !allActive.isEmpty {
                let noVideo = allActive.filter { $0.episodes == 0 }
                Section {
                    Toggle("Solo los que no tienen video (\(noVideo.count))", isOn: $onlyNoVideo)
                    ForEach(onlyNoVideo ? noVideo : allActive) { row($0) }
                }
            } else if !isLoading && bundle.review.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Todavía no registras tu equipo").font(.headline)
                        Text("Agrega tu dron, tu portátil, tu cámara o tus gadgets (uno por uno o pegando una lista) y las ideas de episodios los tendrán en cuenta.")
                            .font(.callout).foregroundStyle(Palette.muted)
                    }
                }
            }

            if !bundle.gone.isEmpty {
                Section {
                    DisclosureGroup("Ya no están (\(bundle.gone.count))") {
                        ForEach(bundle.gone) { row($0) }
                    }
                }
            }
        }
        .navigationTitle("Mi equipo")
        .overlay { if isLoading && bundle.items.isEmpty { ProgressView() } }
        .toolbar {
            if canEdit {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { showingAdd = true } label: { Label("Agregar equipo", systemImage: "plus") }
                        Button { showingPaste = true } label: { Label("Pegar una lista", systemImage: "list.clipboard") }
                            .disabled(parsing)
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Agregar")
                }
            }
        }
        .sheet(isPresented: $showingAdd) {
            NavigationStack { GearEditorView(gear: nil, photoURL: nil) { await load() } }
        }
        .sheet(item: $editing) { gear in
            NavigationStack {
                GearEditorView(gear: gear, photoURL: bundle.items.first { $0.id == gear.id }?.photoURL) { await load() }
            }
        }
        .sheet(isPresented: $showingPaste) {
            NavigationStack { PasteGearListView { await load() } }
        }
        .confirmationDialog("¿Borrar «\(deleting?.label ?? "")» del inventario?", isPresented: Binding(
            get: { deleting != nil }, set: { if !$0 { deleting = nil } }
        ), titleVisibility: .visible) {
            Button("Borrar", role: .destructive) {
                if let g = deleting { act { try await model.deleteGear(g.id) } }
            }
        }
        .task(id: model.selectedChannelId) { await load() }
        .task(id: parsing) { await watchParsing() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func row(_ item: GearItem) -> some View {
        let g = item.row
        GearRowView(item: item, today: model.today)
            .contentShape(Rectangle())
            .onTapGesture { if canEdit { editing = g } }
            .swipeActions(edge: .trailing) {
                if canEdit {
                    Button(g.status == .review ? "Descartar" : "Borrar", role: .destructive) {
                        if g.status == .review { act { try await model.deleteGear(g.id) } } else { deleting = g }
                    }
                    if g.status == .active {
                        Button(g.ownership == .loan ? "Ya lo devolví" : "Ya no lo tengo") {
                            act { try await model.setGearStatus(g.id, g.ownership == .loan ? .returned : .retired) }
                        }
                    } else if g.status != .review {
                        Button("Volver a activar") { act { try await model.setGearStatus(g.id, .active) } }
                    }
                }
            }
            .swipeActions(edge: .leading) {
                if canEdit && g.status == .review {
                    Button("Confirmar") { act { try await model.setGearStatus(g.id, .active) } }.tint(Palette.ok)
                }
            }
            .contextMenu {
                if canEdit {
                    if g.status == .review {
                        Button { act { try await model.setGearStatus(g.id, .active) } } label: { Label("Confirmar", systemImage: "checkmark") }
                    }
                    Button { editing = g } label: { Label("Editar", systemImage: "pencil") }
                    if g.status == .active {
                        Button(g.ownership == .loan ? "Ya lo devolví" : "Ya no lo tengo") {
                            act { try await model.setGearStatus(g.id, g.ownership == .loan ? .returned : .retired) }
                        }
                    } else if g.status != .review {
                        Button("Volver a activar") { act { try await model.setGearStatus(g.id, .active) } }
                    }
                    Button(role: .destructive) {
                        if g.status == .review { act { try await model.deleteGear(g.id) } } else { deleting = g }
                    } label: {
                        Label(g.status == .review ? "Descartar" : "Borrar", systemImage: "trash")
                    }
                }
            }
    }

    private func act(_ work: @escaping () async throws -> Void) {
        Task {
            do {
                try await work()
                errorMessage = nil
            } catch is CancellationError {
            } catch {
                errorMessage = error.localizedDescription
            }
            await load()
        }
    }

    private func load() async {
        do {
            bundle = try await model.gearInventory()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    /// Mientras Claude ordena la lista, revisa cada 3 s (como la web).
    private func watchParsing() async {
        guard parsing else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            let task = await model.latestTask(kind: "gear_parse")
            if task?.isActive != true {
                await load()
                return
            }
        }
    }
}

/// Un equipo del inventario: foto, nombre, categoría, origen, devolución y uso.
struct GearRowView: View {
    let item: GearItem
    let today: DateKey

    var body: some View {
        let g = item.row
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: item.photoURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    Palette.surfaceMuted
                    Image(systemName: "shippingbox").foregroundStyle(Palette.muted)
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 4) {
                Text(g.label).font(.body.weight(.medium))
                if g.label != g.name {
                    Text(g.name).font(.caption).foregroundStyle(Palette.muted)
                }
                HStack(spacing: 4) {
                    Badge(text: g.category.label)
                    if g.ownership != .own { Badge(text: g.ownership.label, tone: .accent) }
                    if let days = g.daysLeft(today: today) {
                        Badge(text: Self.returnText(days), tone: days < 0 ? .critical : days <= loanWarnDays ? .warn : .neutral)
                    }
                    if g.status == .retired || g.status == .returned { Badge(text: g.status.label) }
                }
                let line = Self.usageLine(item, today: today)
                if !line.isEmpty {
                    Text(line).font(.caption).foregroundStyle(Palette.muted)
                }
                if !g.notes.isEmpty {
                    Text(g.notes).font(.caption).foregroundStyle(Palette.muted).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
    }

    /// «5 meses contigo · En 2 episodios» (sin el uso mientras está por revisar).
    static func usageLine(_ item: GearItem, today: DateKey) -> String {
        var parts: [String] = []
        if let months = gearAgeMonths(item.row.acquiredOn, today: today) { parts.append(monthsText(months)) }
        if item.row.status != .review {
            let n = item.episodes
            parts.append(n > 0 ? "En \(n) \(n == 1 ? "episodio" : "episodios")" : "Sin video todavía")
        }
        return parts.joined(separator: " · ")
    }

    static func monthsText(_ months: Int) -> String {
        months == 0 ? "Recién llegado" : "\(months) \(months == 1 ? "mes" : "meses") contigo"
    }

    static func returnText(_ days: Int) -> String {
        if days < 0 { return "Devolución vencida hace \(-days) \(-days == 1 ? "día" : "días")" }
        if days == 0 { return "Se devuelve hoy" }
        return "Se devuelve en \(days) \(days == 1 ? "día" : "días")"
    }
}

/// Agregar o editar un equipo, con su foto.
struct GearEditorView: View {
    let gear: GearRow?
    let photoURL: URL?
    let onDone: () async -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var input = GearInput(name: "")
    @State private var hasAcquired = false
    @State private var acquired = Date()
    @State private var returnDate = Date()
    @State private var picked: PhotosPickerItem?
    @State private var newPhoto: Data?
    @State private var removePhoto = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                TextField("Nombre (Mi dron, el portátil del estudio…)", text: $input.name)
                TextField("Marca", text: $input.brand)
                TextField("Modelo", text: $input.model)
                Picker("Categoría", selection: $input.category) {
                    ForEach(GearCategory.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Picker("Origen", selection: $input.ownership) {
                    ForEach(GearOwnership.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Toggle("Sé desde cuándo lo tengo", isOn: $hasAcquired)
                if hasAcquired {
                    DatePicker("Desde cuándo lo tienes", selection: $acquired, displayedComponents: .date)
                }
                if input.ownership == .loan {
                    DatePicker("Fecha de devolución", selection: $returnDate, displayedComponents: .date)
                }
            } footer: {
                if input.ownership != .own {
                    Text("Lo que viene de una marca lleva la aclaración de contenido patrocinado que pide YouTube; el guion la incluirá.")
                }
            }

            Section {
                TextField("https://", text: Binding(get: { input.affiliateUrl ?? "" }, set: { input.affiliateUrl = $0 }))
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            } header: {
                Text("Enlace de afiliado")
            } footer: {
                Text("Opcional, para la descripción.")
            }

            Section("Notas") {
                TextField("Configuración, accesorios, qué tal te ha ido, lo que quieres probar…", text: $input.notes, axis: .vertical)
                    .lineLimit(3...8)
            }

            Section("Foto del equipo") {
                HStack(spacing: 12) {
                    Group {
                        if let newPhoto, let image = UIImage(data: newPhoto) {
                            Image(uiImage: image).resizable().scaledToFill()
                        } else if !removePhoto, let photoURL {
                            AsyncImage(url: photoURL) { $0.resizable().scaledToFill() } placeholder: { Palette.surfaceMuted }
                        } else {
                            ZStack {
                                Palette.surfaceMuted
                                Image(systemName: "shippingbox").foregroundStyle(Palette.muted)
                            }
                        }
                    }
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 8) {
                        PhotosPicker(selection: $picked, matching: .images) {
                            Text(hasPhoto ? "Cambiar foto" : "Agregar foto")
                        }
                        if hasPhoto {
                            Button("Quitar foto", role: .destructive) {
                                newPhoto = nil
                                removePhoto = true
                            }
                        }
                    }
                }
            }

            let problems = currentInput.problems
            if !problems.isEmpty && !input.name.isEmpty {
                Section {
                    ForEach(problems, id: \.self) { Text($0).font(.caption).foregroundStyle(Palette.critical) }
                }
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(Palette.critical) }
            }
        }
        .navigationTitle(gear == nil ? "Agregar equipo" : "Editar equipo")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView()
                } else {
                    Button("Guardar") { save() }.disabled(!currentInput.problems.isEmpty)
                }
            }
        }
        .onAppear(perform: fill)
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    newPhoto = data
                    removePhoto = false
                } else {
                    errorMessage = MediaError.unreadable.localizedDescription
                }
                picked = nil
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var hasPhoto: Bool { newPhoto != nil || (!removePhoto && photoURL != nil) }

    /// Lo que se manda: las fechas salen de los selectores.
    private var currentInput: GearInput {
        var g = input
        g.acquiredOn = hasAcquired ? Self.key(acquired) : nil
        g.returnBy = input.ownership == .loan ? Self.key(returnDate) : nil
        return g
    }

    private func fill() {
        guard let gear else { return }
        input = gear.input
        if let a = gear.acquiredOn, let d = Self.date(a) {
            hasAcquired = true
            acquired = d
        }
        if let r = gear.returnBy, let d = Self.date(r) { returnDate = d }
    }

    private func save() {
        isSaving = true
        errorMessage = nil
        var photo = GearPhotoChange.keep
        if let newPhoto { photo = .replace(newPhoto) } else if removePhoto { photo = .remove }
        Task {
            defer { isSaving = false }
            do {
                try await model.saveGear(currentInput, editing: gear, photo: photo)
                await onDone()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func key(_ date: Date) -> DateKey { formatter.string(from: date) }
    static func date(_ key: DateKey) -> Date? { formatter.date(from: key) }
}

/// «Pegar una lista»: Claude la ordena y los equipos quedan por revisar.
struct PasteGearListView: View {
    let onDone: () async -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        Form {
            Section {
                TextField("DJI Mini 4 Pro\nMacBook Air M3 15\"\nAirPods Pro 2\nSony ZV-E10", text: $text, axis: .vertical)
                    .lineLimit(6...16)
            } footer: {
                Text("Pega tus equipos, uno por línea o separados por comas. Claude los ordena en marca, modelo y categoría y quedan «por revisar» antes de entrar al inventario.")
            }
            Section {
                ServerActionButton(title: "Ordenar con Claude", systemImage: "wand.and.stars", prominent: true,
                                   cost: GearCredits.parse,
                                   action: { try await model.pasteGearList(String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(8000))) },
                                   onDone: {
                                       await onDone()
                                       dismiss()
                                   })
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
            }
        }
        .navigationTitle("Pegar una lista")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
        }
    }
}
