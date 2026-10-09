import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Package } from "lucide-react";
import { localDateKey } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { GearCard } from "@/components/gear/gear-card";
import { GearDialog } from "@/components/gear/gear-dialog";
import { PasteGearList } from "@/components/gear/paste-list";
import { getChannelContext, getSupabase } from "@/lib/auth";
import { loadGear } from "@/lib/data/gear";

export const metadata: Metadata = { title: "Mi equipo" };

/**
 * «Mi equipo»: los dispositivos del canal (propios o de marcas). De aquí salen
 * ideas de episodios que solo este canal puede hacer.
 */
export default async function GearPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ sin?: string }>;
}) {
  const { channelId } = await params;
  const onlyNoVideo = (await searchParams).sin === "1";
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("gear");
  const supabase = await getSupabase();
  const [gear, { data: task }] = await Promise.all([
    loadGear(channelId),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("channel_id", channelId)
      .eq("kind", "gear_parse")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const canEdit = ctx.can("manage_episodes");
  const parsing = task?.status === "queued" || task?.status === "running";
  const today = localDateKey(new Date(), ctx.channel.timezone);
  const review = gear.filter((g) => g.status === "review");
  const allActive = gear.filter((g) => g.status === "active");
  const noVideo = allActive.filter((g) => g.episodes === 0).length;
  const active = onlyNoVideo ? allActive.filter((g) => g.episodes === 0) : allActive;
  const gone = gear.filter((g) => g.status === "retired" || g.status === "returned");
  const list = (items: typeof gear, testId: string) => (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid={testId}>
      {items.map((g) => (
        <GearCard key={g.id} channelId={channelId} gear={g} today={today} canEdit={canEdit} />
      ))}
    </ul>
  );

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <PasteGearList channelId={channelId} active={parsing} />
              <GearDialog channelId={channelId} />
            </div>
          ) : null
        }
      />
      {parsing ? (
        <p role="status" className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {t("parsingDesc")}
        </p>
      ) : task?.status === "failed" ? (
        <p className="mb-4 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
          {t("parseFailed")}
        </p>
      ) : null}
      {review.length ? (
        <section className="mb-8">
          <h2 className="mb-1 font-semibold">{t("reviewTitle", { count: review.length })}</h2>
          <p className="mb-3 text-sm text-muted">{t("reviewDesc")}</p>
          {list(review, "gear-review")}
        </section>
      ) : null}
      {allActive.length ? (
        <p className="mb-3 text-sm">
          <Link
            href={onlyNoVideo ? `/c/${channelId}/equipo` : `/c/${channelId}/equipo?sin=1`}
            className="text-accent hover:underline"
            data-testid="gear-filter"
          >
            {onlyNoVideo ? t("filterAll") : `${t("filterNoVideo")} (${noVideo})`}
          </Link>
        </p>
      ) : null}
      {active.length ? (
        list(active, "gear-active")
      ) : !review.length ? (
        <EmptyState
          icon={<Package className="size-8" />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
        />
      ) : null}
      {gone.length ? (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-muted">
            {t("goneTitle", { count: gone.length })}
          </summary>
          <div className="mt-3">{list(gone, "gear-gone")}</div>
        </details>
      ) : null}
    </Page>
  );
}
