import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { PainToIdeaButton } from "@/components/audience/pain-to-idea";
import { Page, PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getChannelContext } from "@/lib/auth";
import { loadAudience } from "@/lib/data/comments";

export const metadata: Metadata = { title: "Audiencia" };

/**
 * Audiencia (Fase 4 · paso 4): las lecturas de los comentarios de todos los
 * episodios juntas (sección 20.4): dolores para pasar a Ideas, temas que se
 * repiten, correcciones pendientes, ideas y lo que falta responder.
 */
export default async function AudiencePage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("audience");
  const view = await loadAudience(channelId);
  const episodeLink = (id: string) => {
    const ep = view.episodes[id];
    return (
      <Link
        href={`/c/${channelId}/episodios/${id}?tab=distribution`}
        className="text-accent hover:underline"
      >
        {ep ? `${ep.code} · ${ep.title}` : t("title")}
      </Link>
    );
  };
  return (
    <Page>
      <PageHeader title={t("title")} />
      {!view.hasReadings && !view.pending.length ? (
        <EmptyState
          icon={<MessagesSquare className="size-8" />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
        />
      ) : (
        <div className="space-y-6" data-testid="audience">
          <Card>
            <CardHeader title={t("painsTitle")} description={t("painsDesc")} />
            <CardBody>
              {view.pains.length ? (
                <ul className="divide-y divide-border" data-testid="audience-pains">
                  {view.pains.map((p) => (
                    <li
                      key={`${p.episodeId}-${p.index}`}
                      className="flex flex-wrap items-start gap-3 py-3 text-sm first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-medium">{p.pain}</p>
                        <p className="text-muted">
                          {t("painLine", { count: p.count, quote: p.quote })}
                        </p>
                        <p className="text-xs">{episodeLink(p.episodeId)}</p>
                      </div>
                      {ctx.can("write_script") ? (
                        <PainToIdeaButton
                          channelId={channelId}
                          episodeId={p.episodeId}
                          index={p.index}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">—</p>
              )}
            </CardBody>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("pendingTitle")} />
              <CardBody>
                {view.pending.length ? (
                  <ul className="space-y-1 text-sm" data-testid="audience-pending">
                    {view.pending.map((p) => (
                      <li key={p.episodeId}>
                        {episodeLink(p.episodeId)}{" "}
                        <span className="text-muted">· {t("pendingLine", { count: p.count })}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{t("noPending")}</p>
                )}
              </CardBody>
            </Card>
            {view.themes.length ? (
              <Card>
                <CardHeader title={t("themesTitle")} />
                <CardBody>
                  <ul className="space-y-1 text-sm">
                    {view.themes.slice(0, 15).map((x) => (
                      <li key={x.theme} className="flex justify-between gap-3">
                        <span>{x.theme}</span>
                        <span className="text-muted tabular-nums">{x.count}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ) : null}
            {view.corrections.length ? (
              <Card>
                <CardHeader title={t("correctionsTitle")} />
                <CardBody>
                  <ul className="space-y-2 text-sm">
                    {view.corrections.map((c, i) => (
                      <li key={i}>
                        {c.text}
                        <div className="text-xs">{episodeLink(c.episodeId)}</div>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ) : null}
            {view.ideas.length ? (
              <Card>
                <CardHeader title={t("ideasTitle")} />
                <CardBody>
                  <ul className="space-y-2 text-sm">
                    {view.ideas.map((c, i) => (
                      <li key={i}>
                        {c.text}
                        <div className="text-xs">{episodeLink(c.episodeId)}</div>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </Page>
  );
}
