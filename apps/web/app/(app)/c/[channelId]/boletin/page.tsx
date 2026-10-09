import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Mail } from "lucide-react";
import { localDateKey, startOfWeek } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { WeeklyDraft } from "@/components/newsletter/draft-button";
import { NewsletterEditor } from "@/components/newsletter/editor";
import { NewsletterSetupNotice } from "@/components/newsletter/setup-notice";
import { getChannelContext, getSupabase } from "@/lib/auth";
import { effectiveStatus, loadNewsletterSetup } from "@/lib/data/newsletter";
import { formatDateKey } from "@/lib/utils";

export const metadata: Metadata = { title: "Boletín" };

/** Videos que se ofrecen para el semanal: los publicados en los últimos 30 días. */
const CANDIDATE_DAYS = 30;

/**
 * Boletín (Fase 4 · paso 5, §21). El semanal resume los videos que Diego
 * elige; el de cada episodio vive en su pestaña Difusión. Aquí está el
 * semanal y el historial de todos.
 */
export default async function NewsletterPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ semana?: string }>;
}) {
  const { channelId } = await params;
  const { semana } = await searchParams;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations();
  const supabase = await getSupabase();
  const now = new Date();
  const tz = ctx.channel.timezone;
  const thisWeek = startOfWeek(localDateKey(now, tz));
  const since = new Date(now.getTime() - CANDIDATE_DAYS * 86_400_000).toISOString();
  const [{ data: newsletters }, setup, { data: task }, { data: eps }] = await Promise.all([
    supabase
      .from("newsletters")
      .select("*, episode:episodes!newsletters_episode_id_fkey(title)")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(30),
    loadNewsletterSetup(channelId),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("channel_id", channelId)
      .eq("kind", "newsletter")
      .is("episode_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("episodes")
      .select("id, title, published_at")
      .eq("channel_id", channelId)
      .eq("status", "published")
      .is("archived_at", null)
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(20),
  ]);
  const list = newsletters ?? [];
  const week = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : thisWeek;
  const current = list.find((n) => n.kind === "weekly" && n.week_start === week) ?? null;
  const canPublish = ctx.can("publish");
  const drafting = task?.status === "queued" || task?.status === "running";
  const fmt = new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz,
  });
  const candidates = (eps ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    published: formatDateKey(localDateKey(new Date(e.published_at!), tz)),
  }));
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const initial = current?.episode_ids.length
    ? current.episode_ids
    : (eps ?? []).filter((e) => new Date(e.published_at!).getTime() >= weekAgo).map((e) => e.id);
  const canDraft = canPublish && week === thisWeek && (!current || current.status === "draft");
  const hasContent = Boolean(current?.subject.trim());

  return (
    <Page>
      <PageHeader
        title={t("newsletter.title", { name: setup.brand.name })}
        description={t("newsletter.subtitle")}
      />
      {canPublish ? <NewsletterSetupNotice channelId={channelId} missing={setup.missing} /> : null}
      {drafting ? (
        <p role="status" className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {t("newsletter.drafting")}
        </p>
      ) : task?.status === "failed" ? (
        <p
          className="mb-4 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical"
          data-testid="newsletter-failed"
        >
          {t("newsletter.failed")}{" "}
          {task.error?.startsWith("errors.") ? t(task.error as "errors.busy") : null}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {current && hasContent ? (
            <NewsletterEditor
              key={`${current.id}:${current.updated_at}`}
              channelId={channelId}
              newsletter={{
                id: current.id,
                heading: t("newsletter.weekOf", {
                  date: formatDateKey(current.week_start, { day: "numeric", month: "long" }),
                }),
                status: effectiveStatus(current, now),
                subject: current.subject,
                preheader: current.preheader,
                body: current.body,
                ctaText: current.cta_text,
                ctaUrl: current.cta_url ?? "",
                point: current.point,
                scheduledAt: current.scheduled_at
                  ? fmt.format(new Date(current.scheduled_at))
                  : null,
                sentAt: current.sent_at ? fmt.format(new Date(current.sent_at)) : null,
                testSentAt: current.test_sent_at
                  ? fmt.format(new Date(current.test_sent_at))
                  : null,
              }}
              brand={setup.brand}
              canPublish={canPublish}
              canSend={canPublish && setup.missing.length === 0}
            />
          ) : (
            <EmptyState
              icon={<Mail className="size-8" />}
              title={t("newsletter.emptyTitle", { date: formatDateKey(week) })}
              description={
                week !== thisWeek
                  ? t("newsletter.emptyPast")
                  : candidates.length
                    ? t("newsletter.emptyDesc")
                    : t("newsletter.noEpisodes")
              }
            />
          )}
        </div>
        <div className="space-y-6">
          {canDraft ? (
            <Card>
              <CardHeader
                title={t("newsletter.pickTitle")}
                description={t("newsletter.pickDesc")}
              />
              <WeeklyDraft
                channelId={channelId}
                candidates={candidates}
                initial={initial}
                active={drafting}
                redo={hasContent}
              />
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("newsletter.history")} description={t("newsletter.historyDesc")} />
            <ul className="divide-y divide-border text-sm" data-testid="newsletter-history">
              {list.length ? (
                list.map((n) => {
                  const s = effectiveStatus(n, now);
                  const href =
                    n.kind === "episode"
                      ? `/c/${channelId}/episodios/${n.episode_id}?tab=distribution#boletin`
                      : `/c/${channelId}/boletin?semana=${n.week_start}`;
                  return (
                    <li key={n.id}>
                      <Link
                        href={href}
                        className={`flex items-center justify-between gap-2 px-5 py-2 hover:bg-surface-muted ${n.id === current?.id ? "font-medium" : ""}`}
                      >
                        <span className="min-w-0 truncate">
                          {n.kind === "episode"
                            ? t("newsletter.episodeOf", { title: n.episode?.title ?? "" })
                            : t("newsletter.weekOf", { date: formatDateKey(n.week_start) })}
                        </span>
                        <Badge
                          tone={s === "sent" ? "ok" : s === "scheduled" ? "accent" : "neutral"}
                        >
                          {t(`newsletter.status.${s}` as "newsletter.status.draft")}
                        </Badge>
                      </Link>
                    </li>
                  );
                })
              ) : (
                <li className="px-5 py-3 text-muted">{t("newsletter.noHistory")}</li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
