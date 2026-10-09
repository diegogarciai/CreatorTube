import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import {
  checklistProgress,
  localDateKey,
  nextStep,
  stageIndex,
  statusIndex,
} from "@planificador/core";
import { Page } from "@/components/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EpisodeResources } from "@/components/episodes/episode-resources";
import { ThumbnailsPanel } from "@/components/episodes/thumbnails-panel";
import { PublicationTitles } from "@/components/episodes/publication-titles";
import { VisualAidsPanel } from "@/components/episodes/visual-aids-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ChecklistPanel } from "@/components/episodes/checklist-panel";
import { DirectionPanel, type DirectionState } from "@/components/episodes/direction-panel";
import { ScriptPanel } from "@/components/episodes/script-panel";
import { ArchiveButton, VideoLink } from "@/components/episodes/episode-actions";
import { EpisodeForm } from "@/components/episodes/episode-form";
import { NextStepPanel } from "@/components/episodes/next-step-panel";
import { StageBar } from "@/components/episodes/stage-bar";
import { StatusBadge } from "@/components/episodes/status-badge";
import { StatusSelect } from "@/components/episodes/status-select";
import { getChannelContext, getSupabase } from "@/lib/auth";
import { toPlannedEpisode } from "@/lib/data/episodes";
import { loadScriptView } from "@/lib/data/script";
import { loadThumbnailsView } from "@/lib/data/thumbnails";
import { loadTitleOptions } from "@/lib/data/titles";
import { loadVisualAidsView } from "@/lib/data/visual-aids";
import { loadEpisodeComments } from "@/lib/data/comments";
import { CommentsPanel } from "@/components/episodes/comments-panel";
import { SocialPostsPanel } from "@/components/episodes/social-posts-panel";
import { loadEpisodeSocials } from "@/lib/data/social-posts";
import { loadEpisodeMetrics } from "@/lib/data/analytics";
import { EpisodeMetricsPanel } from "@/components/analytics/episode-metrics";
import { episodeDependents } from "@/lib/data/dependents";
import { NO_DEPENDENTS } from "@/lib/dependencies";
import {
  defaultProductionTab,
  episodeResources,
  PRODUCTION_TABS,
  productionStates,
  type ProductionTab,
} from "@/lib/resources";
import { getChecklistSteps, getPillars } from "@/lib/data/queries";
import { cn, formatDateKey } from "@/lib/utils";

export const metadata: Metadata = { title: "Episodio" };

const TABS = ["summary", "script", "production", "publication", "distribution", "metrics"] as const;
type Tab = (typeof TABS)[number];
type TabState = "ready" | "missing" | "outdated" | "notApplicable";
const TAB_TONE: Record<TabState, Tone> = {
  ready: "ok",
  missing: "warn",
  outdated: "critical",
  notApplicable: "neutral",
};

export default async function EpisodePage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string; episodeId: string }>;
  searchParams: Promise<{ tab?: string; sub?: string }>;
}) {
  const { channelId, episodeId } = await params;
  const tab: Tab = (TABS as readonly string[]).includes((await searchParams).tab ?? "")
    ? ((await searchParams).tab as Tab)
    : "summary";
  const ctx = await getChannelContext(channelId);
  const supabase = await getSupabase();
  const t = await getTranslations();

  const { data: row } = await supabase
    .from("episodes")
    .select("*")
    .eq("id", episodeId)
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!row) notFound();

  const [
    steps,
    pillars,
    doneRows,
    activity,
    video,
    idea,
    direction,
    guide,
    script,
    thumbnails,
    titles,
    visualAids,
    metrics,
    retentionCount,
  ] = await Promise.all([
    getChecklistSteps(channelId),
    getPillars(channelId),
    supabase.from("episode_checklist_items").select("step_id").eq("episode_id", episodeId),
    supabase
      .from("activity_log")
      .select("id, action, details, created_at, actor:profiles(full_name, email)")
      .eq("episode_id", episodeId)
      .order("created_at", { ascending: false })
      .limit(20),
    row.youtube_video_id
      ? supabase
          .from("youtube_videos")
          .select("*")
          .eq("channel_id", channelId)
          .eq("video_id", row.youtube_video_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    row.idea_id
      ? supabase.from("ideas").select("title").eq("id", row.idea_id).maybeSingle()
      : Promise.resolve({ data: null }),
    tab === "script"
      ? supabase
          .from("episode_direction")
          .select("status, reading, questions, answers, extra, task:tasks(status, error)")
          .eq("episode_id", episodeId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    tab === "script"
      ? supabase
          .from("writer_guides")
          .select("current_version_id")
          .eq("channel_id", channelId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    tab === "script"
      ? loadScriptView(episodeId, row.current_script_run_id, {
          channelId,
          keywords: row.keywords,
          pillarId: row.pillar_id,
        })
      : null,
    tab === "production"
      ? loadThumbnailsView({
          id: episodeId,
          channelId,
          code: row.code,
          currentScriptRunId: row.current_script_run_id,
        })
      : null,
    tab === "publication"
      ? loadTitleOptions({ id: episodeId, currentScriptRunId: row.current_script_run_id })
      : null,
    tab === "production"
      ? loadVisualAidsView({
          id: episodeId,
          code: row.code,
          currentScriptRunId: row.current_script_run_id,
        })
      : null,
    tab === "metrics" && row.youtube_video_id
      ? loadEpisodeMetrics({
          channelId,
          videoId: row.youtube_video_id,
          currentScriptRunId: row.current_script_run_id,
        })
      : null,
    row.youtube_video_id
      ? supabase
          .from("youtube_video_retention")
          .select("video_id", { count: "exact", head: true })
          .eq("channel_id", channelId)
          .eq("video_id", row.youtube_video_id)
      : Promise.resolve({ count: 0 }),
  ]);
  const comments =
    tab === "distribution" ? await loadEpisodeComments({ id: episodeId, channelId }) : null;
  const socials =
    tab === "distribution"
      ? await loadEpisodeSocials({
          id: episodeId,
          channelId,
          scriptRunId: row.current_script_run_id,
          youtubeVideoId: row.youtube_video_id,
        })
      : null;
  // Lo generado del episodio: qué bloquea cada «Rehacer» y «Borrar».
  const deps =
    tab === "script" || tab === "production"
      ? await episodeDependents(supabase, episodeId, row.current_script_run_id)
      : NO_DEPENDENTS;
  const directionState: DirectionState | null = direction.data
    ? {
        status: direction.data.status,
        reading: direction.data.reading,
        questions: direction.data.questions as unknown as DirectionState["questions"],
        answers: direction.data.answers as unknown as DirectionState["answers"],
        extra: direction.data.extra,
        taskStatus: direction.data.task?.status ?? null,
        taskError: direction.data.task?.error ?? null,
      }
    : null;

  const tz = ctx.channel.timezone;
  const episode = toPlannedEpisode(row, tz);
  const step = nextStep(episode, localDateKey(new Date(), tz));
  const done = new Set((doneRows.data ?? []).map((r) => r.step_id));
  const canManage = ctx.can("manage_episodes");
  const canAct = canManage || (ctx.can("edit_video") && step.action === "mark_recorded");
  const published = row.status === "published";
  const afterProgress = checklistProgress(steps, done, "after_publish");

  const states: Record<Tab, TabState> = {
    summary: row.publish_date ? "ready" : "missing",
    script: statusIndex(row.status) > statusIndex("script") ? "ready" : "missing",
    production: stageIndex(row.stage) > stageIndex("preparation") ? "ready" : "missing",
    publication: row.youtube_video_id ? "ready" : "missing",
    distribution: !published ? "notApplicable" : afterProgress.ratio >= 1 ? "ready" : "missing",
    // Listo cuando YouTube ya tiene la curva de retención del video.
    metrics: !published ? "notApplicable" : retentionCount.count ? "ready" : "missing",
  };
  // Subpestañas de Producción: por defecto, la primera fase sin terminar.
  const productionState =
    tab === "production" && thumbnails
      ? productionStates(episodeResources(row.code, visualAids?.aids ?? [], thumbnails.designs))
      : null;
  const requestedSub = (await searchParams).sub ?? "";
  const sub: ProductionTab = (PRODUCTION_TABS as readonly string[]).includes(requestedSub)
    ? (requestedSub as ProductionTab)
    : productionState
      ? defaultProductionTab(productionState)
      : "aids";
  // Se fija en la URL: si no, al refrescar (p. ej. cuando termina un render) saltaría a otra.
  if (productionState && requestedSub !== sub) {
    redirect(`/c/${channelId}/episodios/${episodeId}?tab=production&sub=${sub}`);
  }

  const stateLabel: Record<TabState, string> = {
    ready: t("common.ready"),
    missing: t("common.missing"),
    outdated: t("common.outdated"),
    notApplicable: t("common.notApplicable"),
  };

  return (
    <Page>
      <Link
        href={`/c/${channelId}/produccion`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t("nav.production")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            #{row.number} · {row.code}
            {idea.data ? ` · ${t("episode.fromIdea", { title: idea.data.title })}` : ""}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{row.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={row.status} />
            {row.archived_at ? <Badge>{t("episode.archived")}</Badge> : null}
            {row.publish_date ? (
              <span className="text-muted">
                ▶{" "}
                {formatDateKey(row.publish_date, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            ) : null}
            {row.record_date ? (
              <span className="text-muted">
                ●{" "}
                {formatDateKey(row.record_date, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage || ctx.can("edit_video") ? (
            <StatusSelect episodeId={row.id} status={row.status} role={ctx.role} />
          ) : null}
          {canManage ? (
            <ArchiveButton episodeId={row.id} archived={Boolean(row.archived_at)} />
          ) : null}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <StageBar stage={row.stage} />
        <NextStepPanel
          episodeId={row.id}
          step={step}
          canAct={
            canAct ||
            (ctx.can("write_script") &&
              (step.stage === "direction" ||
                step.stage === "script" ||
                step.stage === "verification"))
          }
          canSkip={canManage}
        />
      </div>

      <nav
        className="mt-8 flex gap-1 overflow-x-auto border-b border-border"
        aria-label="Pestañas del episodio"
      >
        {TABS.map((id) => (
          <Link
            key={id}
            href={`?tab=${id}`}
            scroll={false}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm",
              tab === id
                ? "border-accent font-medium"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {t(`episode.tabs.${id}`)}
            <Badge tone={TAB_TONE[states[id]]} className="hidden sm:inline-flex">
              {stateLabel[states[id]]}
            </Badge>
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "summary" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Card>
              <CardBody>
                <EpisodeForm
                  episodeId={row.id}
                  disabled={!canManage}
                  pillars={pillars.map((p) => ({ id: p.id, name: p.name }))}
                  initial={{
                    title: row.title,
                    format: row.format,
                    priority: row.priority,
                    pillarId: row.pillar_id,
                    publishDate: row.publish_date,
                    recordDate: row.record_date,
                    stance: row.stance,
                    keywords: row.keywords,
                    notes: row.notes,
                    episodeType: row.episode_type,
                    targetMinutes: row.target_minutes,
                    sponsorship: row.sponsorship,
                    ownMeasurements: row.own_measurements,
                    stanceConfirmed: row.stance_confirmed,
                  }}
                />
              </CardBody>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardBody>
                  <ChecklistPanel
                    episodeId={row.id}
                    steps={steps}
                    done={[...done]}
                    phase="before_publish"
                    disabled={!canManage && !ctx.can("edit_video")}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title={t("episode.activity")} />
                <CardBody className="p-0">
                  <ul className="divide-y divide-border text-sm">
                    {(activity.data ?? []).map((a) => {
                      const d = (a.details ?? {}) as { from?: string; to?: string };
                      const who = a.actor?.full_name || a.actor?.email || t("episode.system");
                      const key = `episode.activityAction.${a.action.replace(/\./g, "_")}`;
                      const from = d.from
                        ? a.action === "episode.status_changed"
                          ? t(`status.${d.from}`)
                          : t(`stage.${d.from}`)
                        : "";
                      const to = d.to
                        ? a.action === "episode.status_changed"
                          ? t(`status.${d.to}`)
                          : t(`stage.${d.to}`)
                        : "";
                      return (
                        <li key={a.id} className="px-5 py-2.5">
                          <span className="font-medium">{who}</span>{" "}
                          {t.has(key) ? t(key) : a.action}
                          {from && to ? (
                            <span className="text-muted">
                              {" "}
                              {from} → {to}
                            </span>
                          ) : null}
                          <time className="block text-xs text-muted">
                            {new Intl.DateTimeFormat("es", {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: tz,
                            }).format(new Date(a.created_at))}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                </CardBody>
              </Card>
            </div>
          </div>
        ) : tab === "script" ? (
          <div className="space-y-6">
            {/* Antes del guion, la Dirección va arriba; con guion, es su primera pestaña. */}
            {script?.run ? null : (
              <DirectionPanel
                episodeId={row.id}
                channelId={channelId}
                direction={directionState}
                hasGuide={Boolean(guide.data?.current_version_id)}
                canEdit={ctx.can("write_script")}
                deps={deps}
              />
            )}
            {script ? (
              <ScriptPanel
                direction={
                  script.run ? (
                    <DirectionPanel
                      embedded
                      episodeId={row.id}
                      channelId={channelId}
                      direction={directionState}
                      hasGuide={Boolean(guide.data?.current_version_id)}
                      canEdit={ctx.can("write_script")}
                      deps={deps}
                    />
                  ) : undefined
                }
                episodeId={row.id}
                view={script}
                deps={deps}
                canEdit={ctx.can("write_script")}
                canTag={canManage}
                directionDone={
                  directionState?.status === "answered" || directionState?.status === "skipped"
                }
                targetMinutes={row.target_minutes}
                timezone={tz}
              />
            ) : null}
          </div>
        ) : tab === "production" && thumbnails && productionState ? (
          <div className="space-y-6">
            <nav
              className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1"
              aria-label={t("episode.productionTabs.label")}
            >
              {PRODUCTION_TABS.map((id) => (
                <Link
                  key={id}
                  href={`?tab=production&sub=${id}`}
                  scroll={false}
                  aria-current={sub === id ? "page" : undefined}
                  data-testid={`production-tab-${id}`}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm",
                    sub === id
                      ? "bg-surface-muted font-medium"
                      : "text-muted hover:bg-surface-muted hover:text-text",
                  )}
                >
                  {t(`episode.productionTabs.${id}`)}
                  <Badge tone={TAB_TONE[productionState[id]]} className="hidden sm:inline-flex">
                    {stateLabel[productionState[id]]}
                  </Badge>
                </Link>
              ))}
            </nav>
            {sub === "aids" && visualAids ? (
              <VisualAidsPanel
                episodeId={row.id}
                view={visualAids}
                canEdit={ctx.can("write_script")}
                deps={deps}
              />
            ) : sub === "thumbnails" ? (
              <ThumbnailsPanel
                episodeId={row.id}
                channelId={channelId}
                view={thumbnails}
                canEdit={ctx.can("write_script")}
                deps={deps}
              />
            ) : (
              <EpisodeResources
                episodeCode={row.code}
                aids={visualAids?.aids ?? []}
                designs={thumbnails.designs}
              />
            )}
          </div>
        ) : tab === "publication" ? (
          <div className="space-y-6">
            <PublicationTitles titles={titles ?? []} />
            <Card>
              <CardHeader title={t("episode.linkVideo")} />
              <CardBody className="space-y-4">
                <VideoLink episodeId={row.id} videoId={row.youtube_video_id} canEdit={canManage} />
                {video.data ? (
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted">YouTube</dt>
                      <dd>{video.data.title ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("episode.status")}</dt>
                      <dd>
                        {video.data.privacy_status
                          ? t(`episode.youtubePrivacy.${video.data.privacy_status as "public"}`)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("episode.fetchedLabel")}</dt>
                      <dd>
                        {new Intl.DateTimeFormat("es", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: tz,
                        }).format(new Date(video.data.fetched_at))}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </CardBody>
            </Card>
          </div>
        ) : tab === "distribution" ? (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <Card>
              <CardBody>
                <ChecklistPanel
                  episodeId={row.id}
                  steps={steps}
                  done={[...done]}
                  phase="after_publish"
                  disabled={!canManage}
                />
              </CardBody>
            </Card>
            <div className="min-w-0 space-y-6">
              {socials ? (
                <SocialPostsPanel
                  episodeId={row.id}
                  channelId={channelId}
                  view={socials}
                  canPublish={ctx.can("publish")}
                  canConfigure={ctx.can("configure_channel")}
                />
              ) : null}
              {comments ? (
                <CommentsPanel
                  episodeId={row.id}
                  channelId={channelId}
                  view={comments}
                  canPublish={ctx.can("publish")}
                  hasVideo={Boolean(row.youtube_video_id)}
                />
              ) : null}
            </div>
          </div>
        ) : tab === "metrics" && video.data && metrics ? (
          <EpisodeMetricsPanel
            metrics={metrics}
            durationS={video.data.duration_seconds}
            timezone={tz}
          />
        ) : (
          <EmptyState
            title={t(`episode.tabs.${tab}`)}
            description={t(`episode.tabPlaceholder.${tab as "script" | "production" | "metrics"}`)}
          />
        )}
      </div>
    </Page>
  );
}
