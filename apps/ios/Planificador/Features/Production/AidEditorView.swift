import SwiftUI

/// Corregir los textos de una ayuda visual (`AidEditor` de la web, acción
/// `editAid`). El servidor revisa las reglas de la sección 12 (largos y, en una
/// M, que sus cifras salgan de filas Verificado o Con matiz) y devuelve qué
/// corregir. En una M con guion de animación, los momentos se mantienen tal
/// cual: se editan en la web.
struct AidEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let aid: VisualAidRow
    var onDone: () async -> Void

    @State private var title = ""
    @State private var idea = ""
    @State private var definition = ""
    @State private var elements: [ElementDraft] = []
    @State private var rows = ""
    @State private var footer = ""
    @State private var duration = ""
    @State private var piece = ""

    private var isMotion: Bool { aid.kind == "M" }
    private var isConcept: Bool { aid.kind == "C" }
    private var isList: Bool { aid.kind == "L" }
    /// M con guion de animación: elementos, filas y duración salen de los momentos.
    private var scripted: Bool {
        guard isMotion, case .array(let beats)? = aid.beats else { return false }
        return !beats.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(isConcept ? "Término" : "Título en pantalla", text: $title, axis: .vertical)
                    if isMotion {
                        TextField("Idea visual", text: $idea, axis: .vertical)
                    }
                    if isConcept {
                        TextField("Definición (máx. 14 palabras)", text: $definition, axis: .vertical)
                    }
                } header: {
                    Text("\(aid.code) · \(aid.kindLabel)")
                } footer: {
                    Text("«\(aid.anchor)»")
                }

                if scripted {
                    Section {
                        if let segment = aid.segment, !segment.isEmpty {
                            Text(segment).font(.callout).foregroundStyle(Palette.muted)
                        }
                    } header: {
                        Text("Segmento del guion")
                    } footer: {
                        Text("Esta pieza tiene guion de animación: sus momentos, cifras y duración se editan en la web.")
                    }
                } else if !isConcept {
                    Section {
                        ForEach($elements) { $element in
                            VStack(alignment: .leading, spacing: 6) {
                                TextField("Elemento (2 a 6 palabras)", text: $element.text, axis: .vertical)
                                if isMotion {
                                    HStack {
                                        TextField("Cifra", text: $element.value)
                                        TextField("Unidad", text: $element.unit)
                                    }
                                    .font(.callout)
                                }
                                if isList {
                                    TextField("Dónde empieza", text: $element.anchor, axis: .vertical)
                                        .font(.callout)
                                }
                            }
                        }
                        .onDelete { elements.remove(atOffsets: $0) }
                        if elements.count < 12 {
                            Button {
                                elements.append(ElementDraft())
                            } label: {
                                Label("Agregar elemento", systemImage: "plus")
                            }
                        }
                    } header: {
                        Text("Elementos (2 a 6 palabras)")
                    } footer: {
                        Text("Desliza un elemento a la izquierda para quitarlo.")
                    }
                }

                if isMotion {
                    Section {
                        if !scripted {
                            LabeledContent("Filas de verificación (#)") {
                                TextField("3, 7", text: $rows)
                                    .multilineTextAlignment(.trailing)
                                    .keyboardType(.numbersAndPunctuation)
                            }
                            LabeledContent("Duración (s)") {
                                TextField("8", text: $duration)
                                    .multilineTextAlignment(.trailing)
                                    .keyboardType(.numberPad)
                            }
                        }
                        TextField("Pie", text: $footer, axis: .vertical)
                        Picker("Pieza", selection: $piece) {
                            Text("Sin elegir").tag("")
                            ForEach(aidPieces.indices, id: \.self) { index in
                                Text(aidPieces[index].label).tag(aidPieces[index].key)
                            }
                        }
                    }
                }

                Section {
                    ServerActionButton(title: "Guardar", systemImage: "checkmark", prominent: true,
                                       action: { try await model.editAid(aid.id, input: input) },
                                       onDone: {
                                           await onDone()
                                           dismiss()
                                       })
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } footer: {
                    Text("Al guardar se revisan los largos y, en una M, que cada cifra salga de una fila verificada.")
                }
            }
            .navigationTitle("Editar textos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
            }
            .onAppear(perform: fill)
        }
    }

    private func fill() {
        title = aid.title
        idea = aid.idea ?? ""
        definition = aid.definition ?? ""
        footer = aid.footer ?? ""
        duration = aid.durationS.map(String.init) ?? ""
        piece = aid.piece ?? ""
        rows = (aid.claimRows ?? []).map(String.init).joined(separator: ", ")
        if case .array(let items)? = aid.elements {
            elements = items.compactMap(ElementDraft.init)
        }
    }

    /// Lo mismo que manda la web.
    private var input: JSONAny {
        func optional(_ text: String) -> JSONAny {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? .null : .string(trimmed)
        }
        let parsedRows = rows.split(whereSeparator: { $0 == "," || $0.isWhitespace })
            .compactMap { Int($0.replacingOccurrences(of: "#", with: "")) }
            .filter { $0 > 0 }
        var object: [String: JSONAny] = [
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "idea": optional(idea),
            "definition": optional(definition),
            "elements": .array(elements.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }.map(\.json)),
            "rows": .array(parsedRows.map { .integer($0) }),
            "footer": optional(footer),
            "durationS": Int(duration.trimmingCharacters(in: .whitespaces)).map { .integer($0) } ?? .null,
            "piece": isMotion && !piece.isEmpty ? .string(piece) : .null,
        ]
        if scripted, let beats = aid.beats { object["beats"] = beats }
        return .object(object)
    }
}

/// Un elemento mientras se edita.
private struct ElementDraft: Identifiable {
    let id = UUID()
    var text = ""
    var value = ""
    var unit = ""
    var anchor = ""

    init() {}

    init?(_ json: JSONAny) {
        guard case .object(let object) = json else { return nil }
        func string(_ key: String) -> String {
            switch object[key] {
            case .string(let s)?: return s
            case .integer(let n)?: return String(n)
            case .double(let n)?: return String(n)
            default: return ""
            }
        }
        text = string("text")
        value = string("value")
        unit = string("unit")
        anchor = string("anchor")
    }

    var json: JSONAny {
        func optional(_ text: String) -> JSONAny {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? .null : .string(trimmed)
        }
        return .object([
            "text": .string(text.trimmingCharacters(in: .whitespacesAndNewlines)),
            "value": optional(value),
            "unit": optional(unit),
            "anchor": optional(anchor),
        ])
    }
}

/// Las piezas de una M (`AID_PIECES` y `pieceLabel`).
let aidPieces: [(key: String, label: String)] = [
    ("bars", "Barras"),
    ("ring", "Anillo"),
    ("counter", "Cifra que cuenta"),
    ("timeline", "Línea de tiempo"),
    ("dot_matrix", "Matriz de puntos"),
    ("curve", "Curva"),
    ("before_after", "Antes y después"),
    ("comparison", "Comparación"),
    ("network", "Red de conexiones"),
    ("zoom", "Zoom"),
    ("flow", "Flujo de pasos"),
    ("equation", "La cuenta"),
    ("myth", "Mito y realidad"),
]

extension AppModel {
    func editAid(_ aidId: String, input: JSONAny) async throws {
        try await ServerAPI.run("editAid", [.string(aidId), input])
    }
}
