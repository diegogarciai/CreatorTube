"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Lightbulb, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { searchTermToIdea } from "@/lib/actions/ideas";
import type { SearchTermRow } from "@/lib/data/analytics";
import { useActionError } from "@/lib/use-action-error";

const int = new Intl.NumberFormat("es-CO");

/**
 * Búsquedas que traen gente (banco de ideas): lo que la gente buscó en YouTube
 * para llegar al canal. Las que no tienen un video propio son ideas con demanda.
 */
export function SearchTermsCard({
  channelId,
  terms,
  periodEnd,
  canIdea,
}: {
  channelId: string;
  terms: SearchTermRow[];
  periodEnd: string | null;
  canIdea: boolean;
}) {
  const t = useTranslations("searchTerms");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const shown = onlyGaps ? terms.filter((x) => !x.covered) : terms;
  const gaps = terms.filter((x) => !x.covered).length;
  return (
    <Card data-testid="search-terms">
      <CardHeader
        title={t("title")}
        description={periodEnd ? t("description", { date: periodEnd }) : t("empty")}
        action={
          terms.length ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={onlyGaps}
                onChange={(e) => setOnlyGaps(e.target.checked)}
              />
              {t("onlyGaps", { count: gaps })}
            </label>
          ) : null
        }
      />
      {shown.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-5 py-2 font-medium">{t("col.term")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("col.views")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("col.minutes")}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr
                  key={x.term}
                  className="border-b border-border last:border-0"
                  data-testid={`term-${x.term}`}
                >
                  <td className="px-5 py-2">
                    <span className="font-medium">{x.term}</span>{" "}
                    {x.covered ? null : <Badge tone="warn">{t("gap")}</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{int.format(x.views)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {int.format(Math.round(x.watchMinutes))}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {canIdea ? (
                      <TermToIdea channelId={channelId} term={x.term} done={x.inIdeas} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : terms.length ? (
        <p className="px-5 py-4 text-sm text-muted">{t("noGaps")}</p>
      ) : null}
    </Card>
  );
}

function TermToIdea({
  channelId,
  term,
  done: initial,
}: {
  channelId: string;
  term: string;
  done: boolean;
}) {
  const t = useTranslations("searchTerms");
  const errorText = useActionError();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(initial);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          const res = await searchTermToIdea(channelId, term);
          if (res.ok) {
            setDone(true);
            toast.success(t("ideaCreated"));
          } else toast.error(errorText(res.error));
        })
      }
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : done ? (
        <Check className="size-3.5" />
      ) : (
        <Lightbulb className="size-3.5" />
      )}
      {done ? t("inIdeas") : t("toIdea")}
    </Button>
  );
}
