import SwiftUI
import UIKit
import UserNotifications

/// Ajustes de los avisos diarios.
struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var enabled = NotificationScheduler.shared.isEnabled
    @State private var hour = NotificationScheduler.shared.hour
    @State private var status: UNAuthorizationStatus = .notDetermined

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Aviso diario de alertas", isOn: $enabled)
                    if enabled {
                        Picker("Hora", selection: $hour) {
                            ForEach(5...22, id: \.self) { h in
                                Text(String(format: "%02d:00", h)).tag(h)
                            }
                        }
                    }
                } footer: {
                    Text("Cada día a esa hora te avisamos si \(model.selectedChannel?.name ?? "el canal") tiene alertas críticas o de atención: fechas vencidas, episodios sin guion cerca de publicar o semanas sin cubrir. Los avisos se actualizan cada vez que abres la app.")
                }

                if status == .denied {
                    Section {
                        Text("Los avisos están bloqueados para Planificador en los ajustes del iPhone.")
                        Button("Abrir Ajustes") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        }
                    }
                }
            }
            .navigationTitle("Avisos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") { dismiss() }
                }
            }
            .task { status = await NotificationScheduler.shared.authorizationStatus() }
            .onChange(of: enabled) { _, on in
                Task { await apply(enabled: on) }
            }
            .onChange(of: hour) { _, value in
                NotificationScheduler.shared.hour = value
                Task { await NotificationScheduler.shared.reschedule(model: model) }
            }
        }
    }

    private func apply(enabled on: Bool) async {
        let scheduler = NotificationScheduler.shared
        if on && status == .notDetermined {
            let granted = await scheduler.requestAuthorization()
            status = await scheduler.authorizationStatus()
            if !granted {
                enabled = false
                return
            }
        }
        scheduler.isEnabled = on
        await scheduler.reschedule(model: model)
    }
}
