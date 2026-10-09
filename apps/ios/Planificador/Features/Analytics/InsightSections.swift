import PlanificadorCore
import SwiftUI

/// Alcance de las miniaturas: impresiones, CTR y de dónde vienen (`ReachCard`).
/// Sin `videoId` es el del canal (28 días contra los 28 anteriores); con él, el
/// de un video desde su publicación.
struct ReachSection: View {
    @Environment(AppModel.self) private var model
    var videoId: String?
    @State private var reach: ReachBundle?
    @State private var loaded = false

    var body: some View {
        Section {
            if let reach {
                HStack(spacing: 12) {
                    tile("Impresiones", reach.current.impressions.formatted(.number.precision(.fractionLength(0))),
                         now: reach.current.impressions, before: reach.previous?.impressions)
                    tile("CTR de miniaturas", ctrLabel(reach.current.ctr),
                         now: reach.current.ctr, before: reach.previous?.ctr)
                }
                .padding(.vertical, 4)
                if !reach.sources.isEmpty {
                    Text("De dónde vienen las impresiones").font(.subheadline.weight(.semibold))
                    ForEach(Array(reach.sources.enumerated()), id: \.element.id) { index, source in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(source.label).font(.callout).lineLimit(1)
                            GeometryReader { geo in
                                Capsule()
                                    .fill(index == 0 ? Palette.accent : Palette.muted.opacity(0.4))
                                    .frame(width: max(geo.size.width * source.share, 4), height: 6)
                            }
                            .frame(height: 6)
                            Text("\(source.impressions.formatted(.number.precision(.fractionLength(0)))) · \(percentLabel(source.share * 100)) · CTR \(ctrLabel(source.ctr))")
                                .font(.caption).foregroundStyle(Palette.muted)
                        }
                    }
                }
            } else if loaded {
                Text("Las impresiones y el CTR llegan de YouTube con hasta 48 h de atraso; la primera vez, hasta 2 días después de activarlos. Aparecerán aquí solos.")
                    .font(.callout).foregroundStyle(Palette.muted)
            }
        } header: {
            Text(videoId == nil ? "Alcance de las miniaturas" : "Alcance de la miniatura")
        } footer: {
            if videoId == nil {
                Text("Impresiones y CTR de los últimos 28 días con datos, hasta el \(reach?.lastDay.map { formatDateKey($0) } ?? "—"). El CTR de varios días y las variaciones los calcula la app (clics ÷ impresiones).")
            } else {
                Text("Impresiones y CTR desde la publicación, y de dónde vinieron.")
            }
        }
        .task(id: "\(model.selectedChannelId ?? "")/\(videoId ?? "")") {
            if let videoId {
                reach = await model.videoReach(videoId)
            } else {
                reach = await model.channelReach()
            }
            loaded = true
        }
    }

    private func tile(_ label: String, _ value: String, now: Double?, before: Double?) -> some View {
        let change: Double? = {
            guard let now, let before, before != 0 else { return nil }
            return (now - before) / abs(before)
        }()
        return VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(Palette.muted)
            Text(value).font(.title3.bold().monospacedDigit())
            if let change {
                Text((change >= 0 ? "▲ " : "▼ ") + "\(Int((abs(change) * 100).rounded())) %")
                    .font(.caption2)
                    .foregroundStyle(change >= 0 ? Palette.ok : Palette.critical)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Palette.surfaceMuted, in: RoundedRectangle(cornerRadius: 10))
    }
}

/// Evaluación a 7 días del episodio (`EvaluationCard`).
struct EvaluationSection: View {
    @Environment(AppModel.self) private var model
    let episode: EpisodeRow
    @State private var bundle = EvaluationBundle()

    private var working: Bool { bundle.task?.isActive == true || bundle.status == "pending" }
    private var canEvaluate: Bool { model.can(.manageEpisodes) }

    var body: some View {
        Section {
            if working {
                Label("Evaluando. Tarda menos de un minuto.", systemImage: "hourglass")
                    .font(.callout).foregroundStyle(Palette.warn)
            } else if bundle.task?.failed == true || bundle.status == "failed" {
                Text("No se pudo evaluar." + (bundle.task?.error.map { " \($0)" } ?? ""))
                    .font(.callout).foregroundStyle(Palette.critical)
            } else if bundle.status == "none" {
                if bundle.ready {
                    Text("Ya están los 7 días de datos.").font(.callout)
                } else if let window = bundle.window {
                    Text("Los 7 días de datos llegan hacia el \(formatDateKey(addDays(window.to, 3))) (YouTube los publica con 2 o 3 días de atraso).")
                        .font(.callout).foregroundStyle(Palette.muted)
                }
            }

            if bundle.status == "done", let data = bundle.data {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        if let verdict = data.verdict {
                            Badge(text: verdict.label, tone: verdict == .above ? .ok : verdict == .below ? .critical : .neutral)
                        }
                        if let count = data.baseline?.count {
                            Text(count == 0 ? "Sin episodios anteriores para comparar"
                                 : "Comparado con \(count) \(count == 1 ? "episodio anterior" : "episodios anteriores")")
                                .font(.caption).foregroundStyle(Palette.muted)
                        }
                    }
                    if let summary = data.summary, !summary.isEmpty { Text(summary).font(.callout) }
                    if !data.learnings.isEmpty {
                        Text("Aprendizajes").font(.subheadline.weight(.semibold))
                        ForEach(Array(data.learnings.enumerated()), id: \.offset) { index, learning in
                            Text("\(index + 1). \(learning)").font(.callout)
                        }
                    }
                }
            }

            if let data = bundle.data, bundle.status == "done" || working, !data.metrics.isEmpty {
                ForEach(data.metrics, id: \.metric) { row in
                    metricRow(row)
                }
                if !data.drops.isEmpty {
                    Text("Dónde se fue la gente").font(.subheadline.weight(.semibold))
                    ForEach(data.drops, id: \.index) { drop in
                        (Text("−\(Int((drop.drop * 100).rounded())) % ").foregroundStyle(Palette.critical)
                            + Text("párrafo \(drop.index + 1): \(drop.text)"))
                            .font(.caption)
                    }
                }
            }

            if canEvaluate && bundle.ready && !working {
                ServerActionButton(title: bundle.data == nil ? "Evaluar a los 7 días" : "Volver a evaluar",
                                   systemImage: "checkmark.seal", prominent: bundle.data == nil,
                                   cost: InsightCredits.evaluation,
                                   action: { try await model.evaluateEpisode(episode.id) },
                                   onDone: { await load() })
            }
        } header: {
            Text("Evaluación a 7 días")
        } footer: {
            if let window = bundle.window {
                Text("La primera semana (\(formatDateKey(window.from)) al \(formatDateKey(window.to))) contra la mediana de los últimos episodios del canal. ±10 % es «en línea».")
            }
        }
        .task(id: episode.id) { await load() }
        .task(id: working) { await watch() }
    }

    private func metricRow(_ row: EvaluationMetricRow) -> some View {
        let metric = EvalMetric(rawValue: row.metric)
        let trend = metricTrend(row.delta)
        return HStack {
            Text(metric?.label ?? row.metric).font(.callout)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(format(metric, row.value)).font(.callout.monospacedDigit())
                Text("mediana \(format(metric, row.median))").font(.caption2).foregroundStyle(Palette.muted)
            }
            Text(row.delta.map { ($0 >= 0 ? "+" : "−") + "\(Int((abs($0) * 100).rounded())) %" } ?? "—")
                .font(.caption.monospacedDigit())
                .frame(width: 56, alignment: .trailing)
                .foregroundStyle(trend == .above ? Palette.ok : trend == .below ? Palette.critical : Palette.muted)
        }
    }

    private func format(_ metric: EvalMetric?, _ value: Double?) -> String {
        guard let value else { return "—" }
        switch metric {
        case .ctr?: return percentLabel(value * 100)
        case .averageViewPercentage?: return percentLabel(value)
        case .averageViewDurationS?:
            let s = Int(value.rounded())
            return String(format: "%d:%02d", s / 60, s % 60)
        case .subscribersNet?:
            let n = Int(value.rounded())
            return n > 0 ? "+\(n)" : "\(n)"
        default: return Int(value.rounded()).formatted()
        }
    }

    private func load() async { bundle = await model.evaluation(episode) }

    private func watch() async {
        guard working else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            let task = await model.latestTask(kind: "evaluation", episodeId: episode.id)
            if task?.isActive != true {
                await load()
                return
            }
        }
    }
}

/// Búsquedas que traen gente (`SearchTermsCard`), con «Pasar a Ideas».
struct SearchTermsSection: View {
    @Environment(AppModel.self) private var model
    @State private var bundle = SearchTermsBundle()
    @State private var onlyGaps = false

    var body: some View {
        Section {
            if bundle.terms.isEmpty {
                Text("Aparecen con la próxima actualización de la analítica.").font(.callout).foregroundStyle(Palette.muted)
            } else {
                Toggle("Solo sin video propio (\(bundle.gaps.count))", isOn: $onlyGaps)
                let shown = onlyGaps ? bundle.terms.filter { bundle.gaps.contains($0.term) } : bundle.terms
                if shown.isEmpty {
                    Text("Todas estas búsquedas ya tienen un video del canal.").foregroundStyle(Palette.muted)
                }
                ForEach(shown) { term in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(term.term)
                            if bundle.gaps.contains(term.term) { Badge(text: "Sin video propio", tone: .warn) }
                        }
                        Text("\(Int(term.views?.value ?? 0).formatted()) vistas · \(Int((term.watchMinutes?.value ?? 0).rounded()).formatted()) minutos vistos")
                            .font(.caption).foregroundStyle(Palette.muted)
                        if model.can(.writeScript) {
                            if bundle.inIdeas.contains(term.term) {
                                Label("En Ideas", systemImage: "checkmark").font(.caption).foregroundStyle(Palette.ok)
                            } else {
                                ServerActionButton(title: "Pasar a Ideas", systemImage: "lightbulb",
                                                   action: { try await model.searchTermToIdea(term.term) },
                                                   onDone: { await load() })
                                    .font(.caption)
                            }
                        }
                    }
                }
            }
        } header: {
            Text("Búsquedas que traen gente")
        } footer: {
            Text("Lo que la gente buscó en YouTube para llegar al canal en los 28 días hasta el \(bundle.periodEnd.map { formatDateKey(String($0.prefix(10))) } ?? "—"). Las que no tienen video propio son ideas con demanda.")
        }
        .task(id: model.selectedChannelId) { await load() }
    }

    private func load() async { bundle = (try? await model.searchTerms()) ?? SearchTermsBundle() }
}

/// Auditoría mensual (`AuditCard`): junta las evaluaciones de un mes y propone
/// ajustes a la guía y a los temas.
struct AuditSection: View {
    @Environment(AppModel.self) private var model
    @State private var bundle = AuditBundle()
    @State private var month = ""

    private var audit: AuditRow? { bundle.audits.first { $0.monthKey == month } }
    private var working: Bool { bundle.task?.isActive == true || audit?.status == "pending" }

    var body: some View {
        Section {
            if bundle.months.isEmpty {
                Text("Aparece cuando haya episodios evaluados a los 7 días.").foregroundStyle(Palette.muted)
            } else {
                Picker("Mes", selection: $month) {
                    ForEach(bundle.months) { item in
                        Text("\(monthName(item.month)) (\(item.count) \(item.count == 1 ? "episodio" : "episodios"))").tag(item.month)
                    }
                }
                if working {
                    Label("Auditando. Tarda uno o dos minutos.", systemImage: "hourglass").font(.callout).foregroundStyle(Palette.warn)
                } else if bundle.task?.failed == true || audit?.status == "failed" {
                    Text("No se pudo auditar." + (bundle.task?.error.map { " \($0)" } ?? "")).font(.callout).foregroundStyle(Palette.critical)
                }
                if let audit, audit.status == "done", let proposals = audit.proposals {
                    proposalsView(audit, proposals)
                } else if audit == nil && !working {
                    Text("\(monthName(month).capitalized) todavía no tiene auditoría.").foregroundStyle(Palette.muted)
                }
                if model.can(.manageEpisodes) && !working {
                    ServerActionButton(title: audit?.status == "done" ? "Volver a auditar" : "Auditar el mes",
                                       systemImage: "doc.text.magnifyingglass", cost: InsightCredits.audit,
                                       action: { try await model.auditMonth(month) },
                                       onDone: { await load() })
                }
            }
        } header: {
            Text("Auditoría mensual")
        } footer: {
            Text("Junta las evaluaciones a 7 días de un mes y propone ajustes a la guía del guionista y a los temas, para que los revises.")
        }
        .task(id: model.selectedChannelId) { await load() }
        .task(id: working) { await watch() }
    }

    @ViewBuilder
    private func proposalsView(_ audit: AuditRow, _ proposals: AuditProposals) -> some View {
        if let count = audit.evaluations {
            Text("Con \(count) \(count == 1 ? "episodio evaluado" : "episodios evaluados") de \(monthName(audit.monthKey)).")
                .font(.caption).foregroundStyle(Palette.muted)
        }
        if let summary = proposals.summary, !summary.isEmpty { Text(summary).font(.callout) }

        Text("Ajustes a la guía del guionista").font(.subheadline.weight(.semibold))
        if proposals.guide.isEmpty {
            Text("Sin ajustes a la guía este mes.").font(.callout).foregroundStyle(Palette.muted)
        }
        ForEach(Array(proposals.guide.enumerated()), id: \.offset) { _, item in
            VStack(alignment: .leading, spacing: 2) {
                Text(item.section).font(.caption).foregroundStyle(Palette.muted)
                Text(item.change).font(.callout)
                Text(item.evidence).font(.caption).foregroundStyle(Palette.muted)
            }
        }
        NavigationLink("Editar la guía") { WriterGuideView() }

        Text("Temas").font(.subheadline.weight(.semibold))
        if proposals.topics.isEmpty {
            Text("Sin propuestas de temas este mes.").font(.callout).foregroundStyle(Palette.muted)
        }
        ForEach(Array(proposals.topics.enumerated()), id: \.offset) { index, topic in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    if let action = topic.action {
                        Badge(text: action.label, tone: action == .more ? .ok : action == .less ? .critical : .accent)
                    }
                    Text(topic.topic).font(.callout)
                }
                Text(topic.evidence).font(.caption).foregroundStyle(Palette.muted)
                if model.can(.writeScript) && topic.action != .less {
                    ToIdeaButton { try await model.auditTopicToIdea(auditId: audit.id, index: index) }
                }
            }
        }
    }

    private func load() async {
        bundle = await model.audits()
        if month.isEmpty || !bundle.months.contains(where: { $0.month == month }) {
            month = bundle.months.first?.month ?? ""
        }
    }

    private func watch() async {
        guard working else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            let task = await model.latestTask(kind: "audit")
            if task?.isActive != true {
                await load()
                return
            }
        }
    }
}
