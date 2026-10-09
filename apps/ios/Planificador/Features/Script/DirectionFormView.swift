import SwiftUI

/// Responder las preguntas de dirección (`DirectionPanel` de la web): opciones
/// (una o varias), respuesta propia y «algo más». Desde aquí se guarda, se
/// salta o se arranca el guion con las respuestas.
struct DirectionFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let episodeId: String
    let direction: DirectionRow
    var onDone: () async -> Void

    @State private var answers: [String: DirectionAnswer] = [:]
    @State private var extra = ""

    var body: some View {
        NavigationStack {
            Form {
                if !direction.reading.isEmpty {
                    Section("Cómo leí el tema") { Text(direction.reading).font(.callout) }
                }
                ForEach(Array(direction.questions.enumerated()), id: \.element.id) { index, question in
                    Section {
                        ForEach(question.options ?? [], id: \.self) { option in
                            let selected = answers[question.id]?.selected.contains(option) ?? false
                            Button {
                                toggle(option, in: question)
                            } label: {
                                Label {
                                    Text(option).foregroundStyle(Palette.text)
                                } icon: {
                                    Image(systemName: selected
                                          ? (question.multiple == true ? "checkmark.square.fill" : "largecircle.fill.circle")
                                          : (question.multiple == true ? "square" : "circle"))
                                        .foregroundStyle(selected ? Palette.accent : Palette.muted)
                                }
                            }
                        }
                        TextField("O escribe tu respuesta", text: Binding(
                            get: { answers[question.id]?.text ?? "" },
                            set: { answers[question.id, default: DirectionAnswer(selected: [], text: "")].text = $0 }
                        ), axis: .vertical)
                        .lineLimit(1...4)
                    } header: {
                        Text("\(index + 1). \(question.question)")
                            .textCase(nil)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Palette.text)
                    } footer: {
                        Text([question.why, question.multiple == true ? "Puedes marcar varias." : nil]
                            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " "))
                    }
                }
                Section {
                    TextEditor(text: $extra).frame(minHeight: 90)
                } header: {
                    Text("¿Algo más que el guionista deba saber?")
                } footer: {
                    Text("Datos que tienes, enlaces, una anécdota real o algo que no quieres que se diga.")
                }

                Section {
                    ServerActionButton(
                        title: "Generar guion con mis respuestas", systemImage: "sparkles", prominent: true,
                        cost: CreditEstimate.script,
                        action: {
                            try await model.saveDirection(episodeId, answers: cleanAnswers, extra: extra, skip: false)
                            try await model.startScript(episodeId, from: "dossier")
                        },
                        onDone: { await finish() }
                    )
                    ServerActionButton(
                        title: "Guardar respuestas", systemImage: "tray.and.arrow.down",
                        action: { try await model.saveDirection(episodeId, answers: cleanAnswers, extra: extra, skip: false) },
                        onDone: { await finish() }
                    )
                    ServerActionButton(
                        title: "Saltar: que decida el guionista", systemImage: "forward",
                        action: { try await model.saveDirection(episodeId, answers: [:], extra: extra, skip: true) },
                        onDone: { await finish() }
                    )
                } footer: {
                    Text("Lo que dejes en blanco lo decide el guionista con las reglas. El guion pasa por Estudio, Guion, Verificación con búsqueda en la web y Publicación.")
                }
            }
            .navigationTitle("Dirección")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } }
            }
            .onAppear {
                answers = direction.answers
                extra = direction.extra
            }
        }
    }

    /// Sin respuestas vacías, como las guarda la web.
    private var cleanAnswers: [String: DirectionAnswer] {
        answers.compactMapValues { answer in
            let text = answer.text.trimmingCharacters(in: .whitespacesAndNewlines)
            return answer.selected.isEmpty && text.isEmpty ? nil : DirectionAnswer(selected: answer.selected, text: text)
        }
    }

    private func toggle(_ option: String, in question: DirectionQuestion) {
        var answer = answers[question.id] ?? DirectionAnswer(selected: [], text: "")
        if let i = answer.selected.firstIndex(of: option) {
            answer.selected.remove(at: i)
        } else if question.multiple == true {
            answer.selected.append(option)
        } else {
            answer.selected = [option]
        }
        answers[question.id] = answer
    }

    private func finish() async {
        await onDone()
        dismiss()
    }
}
