import { getTranslations } from "next-intl/server";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { TitleOption } from "@/lib/data/titles";
import { cn } from "@/lib/utils";

const MAX_TITLE = 60;

/** Los títulos del episodio: los del JSON de Publicación y los de las miniaturas elegidas. */
export async function PublicationTitles({ titles }: { titles: TitleOption[] }) {
  const t = await getTranslations("publicationTitles");
  return (
    <Card>
      <CardHeader title={t("title")} description={t("description")} />
      <CardBody className="text-sm">
        {titles.length ? (
          <ul className="divide-y divide-border" data-testid="publication-titles">
            {titles.map((item, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 font-medium">{item.title}</span>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    item.title.length > MAX_TITLE ? "text-warn" : "text-muted",
                  )}
                  title={
                    item.title.length > MAX_TITLE ? t("tooLong", { max: MAX_TITLE }) : undefined
                  }
                >
                  {item.title.length}/{MAX_TITLE}
                </span>
                {item.source.kind === "thumbnail" ? (
                  <span title={item.source.text}>
                    <Badge tone="accent">
                      {t("fromThumbnail", { letter: item.source.letter })}
                    </Badge>
                  </span>
                ) : (
                  <Badge>{t("fromAssets")}</Badge>
                )}
                <CopyButton value={item.title} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("empty")}</p>
        )}
      </CardBody>
    </Card>
  );
}
