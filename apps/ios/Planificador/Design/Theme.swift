import PlanificadorCore
import SwiftUI
import UIKit

/// Colores de `packages/config/src/tokens.ts` y `apps/web/app/globals.css`,
/// con su versión oscura.
enum Palette {
    static let background = Color(light: 0xFAFAF9, dark: 0x0C0A09)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1C1917)
    static let surfaceMuted = Color(light: 0xF5F5F4, dark: 0x292524)
    static let border = Color(light: 0xE7E5E4, dark: 0x3A3633)
    static let text = Color(light: 0x1C1917, dark: 0xFAFAF9)
    static let muted = Color(light: 0x78716C, dark: 0xA8A29E)
    static let accent = Color(light: 0xEA580C, dark: 0xF97316)
    static let accentSoft = Color(light: 0xFFF7ED, dark: 0x2A1A0E)
    static let ok = Color(light: 0x16A34A, dark: 0x4ADE80)
    static let okSoft = Color(light: 0xF0FDF4, dark: 0x0F2A1A)
    static let warn = Color(light: 0xD97706, dark: 0xFBBF24)
    static let warnSoft = Color(light: 0xFFFBEB, dark: 0x2A210A)
    static let critical = Color(light: 0xDC2626, dark: 0xF87171)
    static let criticalSoft = Color(light: 0xFEF2F2, dark: 0x2C1212)
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// Tonos de las insignias (`status-badge.tsx`).
enum Tone {
    case neutral, accent, ok, warn, critical

    var foreground: Color {
        switch self {
        case .neutral: return Palette.muted
        case .accent: return Palette.accent
        case .ok: return Palette.ok
        case .warn: return Palette.warn
        case .critical: return Palette.critical
        }
    }

    var background: Color {
        switch self {
        case .neutral: return Palette.surfaceMuted
        case .accent: return Palette.accentSoft
        case .ok: return Palette.okSoft
        case .warn: return Palette.warnSoft
        case .critical: return Palette.criticalSoft
        }
    }
}

extension EpisodeStatus {
    var tone: Tone {
        switch self {
        case .planned: return .neutral
        case .script: return .accent
        case .toRecord, .editing: return .warn
        case .scheduled, .published: return .ok
        }
    }
}

extension Severity {
    var tone: Tone {
        switch self {
        case .critical: return .critical
        case .warning: return .warn
        case .info: return .neutral
        }
    }
}

extension SignalLevel {
    var tone: Tone {
        switch self {
        case .ok: return .ok
        case .warning: return .warn
        case .critical: return .critical
        }
    }
}
