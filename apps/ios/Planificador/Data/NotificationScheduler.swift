import Foundation
import PlanificadorCore
import UserNotifications

/// Avisos locales: un resumen diario con las alertas críticas y de atención del
/// canal elegido para los próximos 7 días. Se recalculan cada vez que se cargan
/// los episodios (al abrir la app, al refrescar o al editar), así que reflejan
/// lo último que vio el teléfono.
@MainActor
final class NotificationScheduler {
    static let shared = NotificationScheduler()

    static let enabledKey = "notifications_enabled"
    static let hourKey = "notifications_hour"
    static let defaultHour = 9
    private static let idPrefix = "planificador.digest."
    private static let daysAhead = 7

    private let center = UNUserNotificationCenter.current()

    var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: Self.enabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.enabledKey) }
    }

    var hour: Int {
        get { UserDefaults.standard.object(forKey: Self.hourKey) as? Int ?? Self.defaultHour }
        set { UserDefaults.standard.set(newValue, forKey: Self.hourKey) }
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    /// Pide permiso la primera vez. Devuelve si quedó permitido.
    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func clear() async {
        let pending = await center.pendingNotificationRequests()
        let ours = pending.map(\.identifier).filter { $0.hasPrefix(Self.idPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ours)
    }

    func reschedule(model: AppModel) async {
        await clear()
        guard isEnabled, let channel = model.selectedChannel else { return }
        let status = await authorizationStatus()
        guard status == .authorized || status == .provisional else { return }

        let episodes = model.plannedEpisodes
        let today = model.today
        let now = Date()
        for offset in 0..<Self.daysAhead {
            let day = addDays(today, offset)
            let parts = day.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { continue }
            let when = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: hour, minute: 0)
            guard let fireDate = Calendar.current.date(from: when), fireDate > now else { continue }

            let alerts = notifiableAlerts(episodes, day: day, weeklyGoal: channel.weeklyGoal, now: fireDate)
            guard !alerts.isEmpty else { continue }

            let content = UNMutableNotificationContent()
            content.title = Copy.digestTitle(alerts.count, channel: channel.name)
            content.body = Copy.digestBody(alerts)
            content.sound = .default
            content.threadIdentifier = channel.id
            let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            let request = UNNotificationRequest(identifier: Self.idPrefix + day, content: content, trigger: trigger)
            try? await center.add(request)
        }
    }
}

/// Muestra el aviso también si la app está abierta.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
