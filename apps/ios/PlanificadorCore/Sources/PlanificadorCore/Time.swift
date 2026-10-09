import Foundation

/// Fechas en la zona horaria del canal (port de `packages/core/src/time.ts`).
///
/// Las fechas de calendario (grabación, publicación planeada) se guardan como
/// "fechas locales" `YYYY-MM-DD` sin hora: un episodio planeado para el martes
/// es martes en la zona del canal, viva donde viva quien lo mira. Los instantes
/// reales (publicado en YouTube, cambios de estado) son `Date` y se convierten a
/// fecha local con `localDateKey`.
public typealias DateKey = String

public let defaultTimeZone = "America/Bogota"

private let utcCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}()

private func components(_ key: DateKey) -> (year: Int, month: Int, day: Int)? {
    let parts = key.split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
          let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
    else { return nil }
    return (year, month, day)
}

/// Medianoche UTC de la fecha. Las fechas vienen de columnas `date` de Postgres,
/// así que siempre son válidas; si no, se usa 1970-01-01 en vez de cerrar la app.
private func toUtcDate(_ key: DateKey) -> Date {
    guard let c = components(key),
          let date = utcCalendar.date(from: DateComponents(year: c.year, month: c.month, day: c.day))
    else { return Date(timeIntervalSince1970: 0) }
    return date
}

private func fromUtcDate(_ date: Date) -> DateKey {
    let c = utcCalendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
}

/// Fecha local `YYYY-MM-DD` de un instante en la zona `timeZone`.
public func localDateKey(_ date: Date, timeZone: String) -> DateKey {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timeZone) ?? TimeZone(identifier: defaultTimeZone)!
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
}

public func isDateKey(_ value: String) -> Bool {
    guard components(value) != nil else { return false }
    return fromUtcDate(toUtcDate(value)) == value
}

public func addDays(_ key: DateKey, _ days: Int) -> DateKey {
    fromUtcDate(utcCalendar.date(byAdding: .day, value: days, to: toUtcDate(key))!)
}

/// Días de `from` a `to` (positivo si `to` es posterior).
public func diffDays(_ from: DateKey, _ to: DateKey) -> Int {
    Int((toUtcDate(to).timeIntervalSince(toUtcDate(from)) / 86_400).rounded())
}

/// Día de la semana ISO: 1 = lunes … 7 = domingo.
public func isoWeekday(_ key: DateKey) -> Int {
    // Calendar: 1 = domingo … 7 = sábado.
    let weekday = utcCalendar.component(.weekday, from: toUtcDate(key))
    return weekday == 1 ? 7 : weekday - 1
}

/// Lunes de la semana que contiene `key`. Las semanas empiezan en lunes.
public func startOfWeek(_ key: DateKey) -> DateKey {
    addDays(key, 1 - isoWeekday(key))
}

public func weekDays(_ weekStart: DateKey) -> [DateKey] {
    (0..<7).map { addDays(weekStart, $0) }
}

public func isWithin(_ key: DateKey, _ start: DateKey, _ endInclusive: DateKey) -> Bool {
    key >= start && key <= endInclusive
}

/// Primer día del mes de `key`.
public func startOfMonth(_ key: DateKey) -> DateKey {
    String(key.prefix(8)) + "01"
}

public func addMonths(_ key: DateKey, _ months: Int) -> DateKey {
    fromUtcDate(utcCalendar.date(byAdding: .month, value: months, to: toUtcDate(startOfMonth(key)))!)
}

/// Cuadrícula de un mes para el calendario: semanas completas de lunes a
/// domingo que cubren el mes de `key`.
public func monthGrid(_ key: DateKey) -> [[DateKey]] {
    let first = startOfMonth(key)
    let nextMonth = addMonths(first, 1)
    var weeks: [[DateKey]] = []
    var cursor = startOfWeek(first)
    while cursor < nextMonth {
        weeks.append(weekDays(cursor))
        cursor = addDays(cursor, 7)
    }
    return weeks
}

/// Día del mes (1…31) de una fecha.
public func dayOfMonth(_ key: DateKey) -> Int {
    components(key)?.day ?? 1
}

private let formatterLock = NSLock()
private var formatterCache: [String: DateFormatter] = [:]

/// Formatea una fecha en español, como `formatDateKey` de la web
/// (`d MMM` → "7 oct"). Se interpreta en UTC para no correr el día.
public func formatDateKey(_ key: DateKey, template: String = "d MMM") -> String {
    formatterLock.lock()
    defer { formatterLock.unlock() }
    let formatter: DateFormatter
    if let cached = formatterCache[template] {
        formatter = cached
    } else {
        formatter = DateFormatter()
        formatter.locale = Locale(identifier: "es")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.calendar = utcCalendar
        formatter.dateFormat = template
        formatterCache[template] = formatter
    }
    return formatter.string(from: toUtcDate(key))
}
