import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { Page, PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getChannelContext } from "@/lib/auth";

export const metadata: Metadata = { title: "Audiencia" };

export default async function AudiencePage({ params }: { params: Promise<{ channelId: string }> }) {
  await getChannelContext((await params).channelId);
  const t = await getTranslations("audience");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <EmptyState icon={<MessagesSquare className="size-8" />} title={t("emptyTitle")} description={t("emptyDesc")} />
    </Page>
  );
}
