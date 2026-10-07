import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, isDateKey, localDateKey, monthGrid, startOfMonth } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { CopyField } from "@/components/copy-field";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { getChannelContext } from "@/lib/auth";
import { env } from "@/lib/env";
import { getEpisodes } from "@/lib/data/queries";
import { formatDateKey } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendario" };

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ mes?: string }>;
}) {
  const { channelId } = await params;
  const { mes } = await searchParams;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("calendar");
  const today = localDateKey(new Date(), ctx.channel.timezone);
  const month = mes && isDateKey(`${mes}-01`) ? `${mes}-01` : startOfMonth(today);
  const rows = await getEpisodes(channelId);
  const icsUrl = `${env.appUrl}/api/ics/${ctx.channel.ics_token}.ics`;
  const nav = (key: string) => `/c/${channelId}/calendario?mes=${key.slice(0, 7)}`;

  return (
    <Page wide>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Link href={nav(addMonths(month, -1))} className={buttonClass("secondary", "sm")} aria-label={t("prev")}>
              <ChevronLeft className="size-4" />
            </Link>
            <span className="min-w-36 text-center font-medium capitalize">{formatDateKey(month, { month: "long", year: "numeric" })}</span>
            <Link href={nav(addMonths(month, 1))} className={buttonClass("secondary", "sm")} aria-label={t("next")}>
              <ChevronRight className="size-4" />
            </Link>
            <Link href={nav(today)} className={buttonClass("ghost", "sm")}>
              {t("today")}
            </Link>
          </div>
        }
      />
      <MonthCalendar
        weeks={monthGrid(month)}
        month={month.slice(0, 7)}
        today={today}
        channelId={channelId}
        canEdit={ctx.can("manage_episodes")}
        episodes={rows.map((r) => ({
          id: r.id,
          number: r.number,
          title: r.title,
          status: r.status,
          publishDate: r.publish_date,
          recordDate: r.record_date,
        }))}
      />
      <Card className="mt-6 max-w-2xl">
        <CardBody>
          <h2 className="font-semibold">{t("subscribe")}</h2>
          <p className="mb-3 mt-0.5 text-sm text-muted">{t("subscribeDesc")}</p>
          <CopyField value={icsUrl} label={t("subscribe")} />
          <a href={icsUrl.replace(/^https?:/, "webcal:")} className="mt-2 inline-block text-sm text-accent hover:underline">
            webcal://
          </a>
        </CardBody>
      </Card>
    </Page>
  );
}
