import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Mail } from "lucide-react";
import { localDateKey, parseBrandKit, startOfWeek } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DraftNewsletterButton } from "@/components/newsletter/draft-button";
import { NewsletterEditor } from "@/components/newsletter/editor";
import { getChannelContext, getSupabase } from "@/lib/auth";
import { EMAIL_CONFIGURED } from "@/lib/email";
import { formatDateKey } from "@/lib/utils";

export const metadata: Metadata = { title: "Boletín" };

/**
 * Boletín semanal (Fase 4 · paso 5, §21): uno por semana. Claude lo redacta a
 * pedido con lo publicado en los últimos 7 días; se edita, se prueba y se
 * envía o se programa con Resend.
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
  const thisWeek = startOfWeek(localDateKey(now, ctx.channel.timezone));
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [
    { data: newsletters },
    { data: settings },
    { data: brand },
    { data: task },
    { data: eps },
  ] = await Promise.all([
    supabase
      .from("newsletters")
      .select("*")
      .eq("channel_id", channelId)
      .order("week_start", { ascending: false })
      .limit(12),
    supabase
      .from("distribution_settings")
      .select("newsletter_name, sender_email, newsletter_segment_id")
      .eq("channel_id", channelId)
      .maybeSingle(),
    supabase.from("brand_kits").select("colors").eq("channel_id", channelId).maybeSingle(),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("channel_id", channelId)
      .eq("kind", "newsletter")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("episodes")
      .select("id, title")
      .eq("channel_id", channelId)
      .eq("status", "published")
      .is("archived_at", null)
      .gte("published_at", since)
      .order("published_at", { ascending: false }),
  ]);
  const list = newsletters ?? [];
  const week = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : thisWeek;
  const current = list.find((n) => n.week_start === week) ?? null;
  const canPublish = ctx.can("publish");
  const drafting = task?.status === "queued" || task?.status === "running";
  const name = settings?.newsletter_name || "El Punto";
  const kit = parseBrandKit(brand ? { colors: brand.colors } : null);
  const missing = [
    ...(EMAIL_CONFIGURED() ? [] : ["key"]),
    ...(settings?.newsletter_segment_id ? [] : ["segment"]),
    ...(settings?.sender_email ? [] : ["sender"]),
  ];
  const effective = (n: (typeof list)[number]) =>
    n.status === "scheduled" && n.scheduled_at && new Date(n.scheduled_at) <= now
      ? "sent"
      : n.status;
  const fmt = new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.channel.timezone,
  });
  const recent = eps ?? [];
  const canDraft = canPublish && week === thisWeek && (!current || current.status === "draft");

  return (
    <Page>
      <PageHeader
        title={t("newsletter.title", { name })}
        description={t("newsletter.subtitle")}
        actions={
          canDraft && recent.length ? (
            <DraftNewsletterButton
              channelId={channelId}
              active={drafting}
              redo={Boolean(current)}
            />
          ) : null
        }
      />
      {missing.length && canPublish ? (
        <p
          className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"
          data-testid="newsletter-setup"
        >
          {t("newsletter.setup", {
            items: missing.map((m) => t(`newsletter.missing.${m}`)).join(", "),
          })}{" "}
          <Link href={`/c/${channelId}/ajustes`} className="underline">
            {t("newsletter.setupLink")}
          </Link>
        </p>
      ) : null}
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
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          {current ? (
            <NewsletterEditor
              key={`${current.id}:${current.updated_at}`}
              channelId={channelId}
              newsletter={{
                id: current.id,
                weekStart: formatDateKey(current.week_start, { day: "numeric", month: "long" }),
                status: effective(current),
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
              brand={{ name, accent: kit.colors.accent, ink: kit.colors.canvas }}
              canPublish={canPublish}
              canSend={canPublish && missing.length === 0}
            />
          ) : (
            <EmptyState
              icon={<Mail className="size-8" />}
              title={t("newsletter.emptyTitle", { date: formatDateKey(week) })}
              description={
                week !== thisWeek
                  ? t("newsletter.emptyPast")
                  : recent.length
                    ? t("newsletter.emptyDesc", { count: recent.length })
                    : t("newsletter.noEpisodes")
              }
              action={
                canDraft && recent.length ? (
                  <DraftNewsletterButton
                    channelId={channelId}
                    active={drafting}
                    variant="primary"
                  />
                ) : null
              }
            />
          )}
        </div>
        <div className="space-y-6">
          {week === thisWeek && recent.length ? (
            <Card>
              <CardHeader title={t("newsletter.episodes")} />
              <ul className="space-y-1 px-5 pb-4 text-sm">
                {recent.slice(0, 3).map((e) => (
                  <li key={e.id}>
                    <Link href={`/c/${channelId}/episodios/${e.id}`} className="hover:underline">
                      {e.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("newsletter.history")} />
            <ul className="divide-y divide-border text-sm" data-testid="newsletter-history">
              {list.length ? (
                list.map((n) => {
                  const s = effective(n);
                  return (
                    <li key={n.id}>
                      <Link
                        href={`/c/${channelId}/boletin?semana=${n.week_start}`}
                        className={`flex items-center justify-between gap-2 px-5 py-2 hover:bg-surface-muted ${n.week_start === week ? "font-medium" : ""}`}
                      >
                        <span className="min-w-0 truncate">
                          {t("newsletter.weekOf", { date: formatDateKey(n.week_start) })}
                        </span>
                        <Badge
                          tone={s === "sent" ? "ok" : s === "scheduled" ? "accent" : "neutral"}
                        >
                          {t(`newsletter.status.${s}`)}
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
