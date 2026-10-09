import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  newsQueries,
  suggestIdeas,
  usdToCredits,
  type SearchResult,
  type StreamClient,
} from "@planificador/ai";
import {
  gearAgeMonths,
  gearLabel,
  localDateKey,
  loanDaysLeft,
  OUTLIER_MIN_RATIO,
  sectionsText,
  termCovered,
  type AuditProposals,
  type CommentReading,
  type GearOwnership,
  type GearStatus,
  type GuideSection,
} from "@planificador/core";
import type { Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { parallelConfigFromEnv, parallelSearch } from "../lib/parallel";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/**
 * Ideas propuestas por IA (banco de ideas): junta lo que el canal sabe de su
 * audiencia y de la competencia, busca noticias del nicho y le pide a Claude
 * ideas con sus cinco señales. Quedan «sugeridas» en el banco.
 */
export const ideaSuggestionsTask = schemaTask({
  id: "idea_suggestions",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runIdeaSuggestions(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    ),
});

/** Las noticias del nicho (Parallel); sin la clave, se sigue sin noticias. */
export interface NewsSearcher {
  search: (objective: string, queries: string[]) => Promise<SearchResult[]>;
  pricePerSearchUsd: number;
}

function newsFromEnv(): NewsSearcher | null {
  try {
    const config = parallelConfigFromEnv(process.env);
    return { search: parallelSearch(config), pricePerSearchUsd: config.pricePerSearchUsd };
  } catch {
    return null;
  }
}

export async function runIdeaSuggestions(
  taskId: string,
  db: ServiceClient,
  anthropic: StreamClient,
  news: () => NewsSearcher | null = newsFromEnv,
) {
  return runTracked(
    taskId,
    async (report) => {
      const { data: task, error } = await db
        .from("tasks")
        .select("workspace_id, channel_id, requested_by")
        .eq("id", taskId)
        .single();
      if (error) throw error;
      if (!task.channel_id) throw new Error("La tarea no tiene canal");
      const channelId = task.channel_id;

      await report.progress(0.1, "Juntando lo que sabe el canal");
      const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const [
        { data: channel },
        { data: pillars },
        { data: guide },
        { data: episodes },
        { data: bank },
        { data: terms },
        { data: outliers },
        { data: readings },
        { data: requests },
        { data: audit },
        { data: gear },
      ] = await Promise.all([
        db.from("channels").select("name, timezone").eq("id", channelId).single(),
        db
          .from("pillars")
          .select("id, name, description")
          .eq("channel_id", channelId)
          .is("archived_at", null),
        db
          .from("writer_guides")
          .select("version:writer_guide_versions!writer_guides_current_version_fk(sections)")
          .eq("channel_id", channelId)
          .maybeSingle(),
        db
          .from("episodes")
          .select("title, stance, keywords, status, evaluation:episode_evaluations(verdict)")
          .eq("channel_id", channelId)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(60),
        db
          .from("ideas")
          .select("title")
          .eq("channel_id", channelId)
          .in("status", ["new", "in_progress", "suggested"]),
        db
          .from("youtube_search_terms")
          .select("term, views")
          .eq("channel_id", channelId)
          .order("views", { ascending: false }),
        db
          .from("competitor_videos")
          .select("title, ratio, competitor:competitor_channels(title)")
          .eq("channel_id", channelId)
          .gte("ratio", OUTLIER_MIN_RATIO)
          .gte("published_at", since60)
          .order("ratio", { ascending: false })
          .limit(10),
        db
          .from("comment_readings")
          .select("reading")
          .eq("channel_id", channelId)
          .order("updated_at", { ascending: false })
          .limit(10),
        db
          .from("youtube_comments")
          .select("text")
          .eq("channel_id", channelId)
          .eq("kind", "pedido_tema")
          .order("published_at", { ascending: false })
          .limit(10),
        db
          .from("channel_audits")
          .select("proposals")
          .eq("channel_id", channelId)
          .eq("status", "done")
          .order("month", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("gear")
          .select(
            "id, name, brand, model, category, ownership, acquired_on, return_by, status, notes",
          )
          .eq("channel_id", channelId)
          .eq("status", "active")
          .order("created_at")
          .limit(60),
      ]);
      const eps = episodes ?? [];
      const texts = eps.flatMap((e) => [e.title, ...(e.keywords ?? [])]);
      const sections = (guide?.version?.sections ?? []) as unknown as GuideSection[];
      const reads = (readings ?? []).map((r) => r.reading as unknown as CommentReading);
      const pillarRows = pillars ?? [];
      const today = new Date();
      const todayKey = localDateKey(today, channel?.timezone ?? "America/Bogota");
      const gearItems = (gear ?? []).map((g) => ({
        id: g.id,
        label: gearLabel(g),
        category: g.category,
        ownership: g.ownership,
        months: gearAgeMonths(g.acquired_on, todayKey),
        returnInDays: loanDaysLeft(
          {
            ownership: g.ownership as GearOwnership,
            return_by: g.return_by,
            status: g.status as GearStatus,
          },
          todayKey,
        ),
        notes: g.notes,
      }));
      const gearId = new Map(gearItems.map((g) => [g.label, g.id]));

      // Noticias del nicho (si Parallel está configurado).
      let newsResults: SearchResult[] = [];
      let searches = 0;
      let searchUsd = 0;
      const searcher = news();
      if (searcher) {
        await report.progress(0.3, "Buscando noticias del nicho");
        const month = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(
          today,
        );
        for (const q of newsQueries(
          pillarRows.map((p) => p.name),
          "tecnología",
          month,
        )) {
          try {
            newsResults.push(
              ...(await searcher.search(
                `Noticias y lanzamientos recientes (último mes) para un canal de YouTube de tecnología: ${q}`,
                [q],
              )),
            );
            searches++;
          } catch {
            // Una búsqueda que falla no frena las ideas.
          }
        }
        searchUsd = searches * searcher.pricePerSearchUsd;
        const seenUrls = new Set<string>();
        newsResults = newsResults.filter((n) => !seenUrls.has(n.url) && seenUrls.add(n.url));
      }

      await report.progress(0.6, "Proponiendo ideas");
      const ai = await loadAiSettings(db, task.workspace_id);
      const out = await suggestIdeas(anthropic, ai.config("ideas"), {
        channelName: channel?.name ?? "",
        audience: sectionsText(sections, ["2"]),
        pillars: pillarRows.map((p) => ({ name: p.name, description: p.description ?? "" })),
        published: eps
          .filter((e) => e.status === "published")
          .map((e) => ({
            title: e.title,
            stance: e.stance,
            verdict: e.evaluation?.verdict ?? null,
          })),
        bank: (bank ?? []).map((b) => b.title),
        searchGaps: (terms ?? [])
          .filter((t) => !termCovered(t.term, texts))
          .slice(0, 15)
          .map((t) => ({ term: t.term, views: t.views })),
        outliers: (outliers ?? []).map((o) => ({
          title: o.title,
          channel: o.competitor?.title ?? "",
          ratio: Number(o.ratio),
        })),
        audiencePains: reads
          .flatMap((r) => (r.pains ?? []).map((p) => `${p.pain} (${p.count})`))
          .slice(0, 15),
        audienceRequests: [
          ...reads.flatMap((r) => r.ideas ?? []),
          ...(requests ?? []).map((c) => c.text.slice(0, 200)),
        ].slice(0, 15),
        auditTopics: ((audit?.proposals as unknown as AuditProposals | null)?.topics ?? []).map(
          (t) => ({ topic: t.topic, action: t.action, evidence: t.evidence }),
        ),
        news: newsResults.slice(0, 20),
        gear: gearItems,
        today: today.toISOString().slice(0, 10),
      });
      const aiUsd = ai.costUsd(out.usage, out.model);
      const usd = aiUsd + searchUsd;
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: channelId,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "idea_suggestions",
        credits: usdToCredits(usd),
        cost_usd: usd,
        meta: {
          model: out.model,
          ...out.usage,
          ai_usd: aiUsd,
          searches,
          search_usd: searchUsd,
          ideas: out.ideas.length,
          gear: gearItems.length,
        } as unknown as Json,
      });

      await report.progress(0.9, "Guardando las ideas");
      if (out.ideas.length) {
        const { error: insError } = await db.from("ideas").insert(
          out.ideas.map((i) => ({
            channel_id: channelId,
            title: i.title,
            notes: [i.angle, i.sources.length ? `Fuentes: ${i.sources.join(" · ")}` : ""]
              .filter(Boolean)
              .join("\n\n")
              .slice(0, 5000),
            origin: "recommendation" as const,
            status: "suggested" as const,
            signals: i.signals as unknown as Json,
            reasons: i.reasons.slice(0, 2000),
            risk: i.risk.slice(0, 2000),
            pillar_id: pillarRows.find((p) => p.name === i.pillar)?.id ?? null,
            gear_ids: i.gear.flatMap((g) => gearId.get(g) ?? []),
            created_by: task.requested_by,
          })),
        );
        if (insError) throw insError;
      }
      return { ideas: out.ideas.length, searches };
    },
    db,
  );
}
