import PlanificadorCore
import SwiftUI

struct Badge: View {
    let text: String
    var tone: Tone = .neutral

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(tone.foreground)
            .background(tone.background, in: Capsule())
    }
}

struct StatusBadge: View {
    let status: EpisodeStatus

    var body: some View {
        Badge(text: status.label, tone: status.tone)
    }
}

/// Tarjeta con título, como las de Inicio en la web.
struct Card<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.muted)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.border))
    }
}

/// Logo de la app (`components/logo.tsx`): cuadrado naranja con una "P".
struct LogoView: View {
    var size: CGFloat = 32

    var body: some View {
        Canvas { context, canvasSize in
            let s = canvasSize.width / 32
            let rect = RoundedRectangle(cornerRadius: 8 * s).path(in: CGRect(origin: .zero, size: canvasSize))
            context.fill(rect, with: .color(Palette.accent))

            var p = Path()
            p.move(to: CGPoint(x: 9 * s, y: 9 * s))
            p.addLine(to: CGPoint(x: 17 * s, y: 9 * s))
            p.addArc(center: CGPoint(x: 17 * s, y: 14 * s), radius: 5 * s,
                     startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false)
            p.addLine(to: CGPoint(x: 13 * s, y: 19 * s))
            p.addLine(to: CGPoint(x: 13 * s, y: 24 * s))
            p.addLine(to: CGPoint(x: 9 * s, y: 24 * s))
            p.closeSubpath()
            context.fill(p, with: .color(.white))

            let dot = Path(ellipseIn: CGRect(x: (16.5 - 1.8) * s, y: (14 - 1.8) * s, width: 3.6 * s, height: 3.6 * s))
            context.fill(dot, with: .color(Palette.accent))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct ProgressBar: View {
    let value: Double
    var tint: Color = Palette.accent

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.surfaceMuted)
                Capsule().fill(tint).frame(width: geo.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 6)
    }
}

/// Mensaje de error con botón para reintentar.
struct ErrorBanner: View {
    let message: String
    var retry: (() async -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message)
                .font(.footnote)
                .foregroundStyle(Palette.critical)
            if let retry {
                Button("Reintentar") { Task { await retry() } }
                    .font(.footnote.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Palette.criticalSoft, in: RoundedRectangle(cornerRadius: 10))
    }
}

/// Ruta de navegación al detalle de un episodio.
struct EpisodeRoute: Hashable {
    let id: String
}
