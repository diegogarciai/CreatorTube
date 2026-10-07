import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@planificador/core";
import { EmptyState } from "@/components/ui/empty-state";
import { Page } from "@/components/page-header";
import { getMyChannels, getMyMemberships } from "@/lib/auth";

/** Entrada a la app: último canal usado, el primero, o la puesta en marcha. */
export default async function AppEntry() {
  const [channels, memberships] = await Promise.all([getMyChannels(), getMyMemberships()]);
  const last = (await cookies()).get("last_channel")?.value;
  const target = channels.find((c) => c.id === last) ?? channels[0];
  if (target) {
    redirect(
      target.onboarding_completed_at ? `/c/${target.id}/inicio` : `/onboarding/canal/${target.id}`,
    );
  }
  if (memberships.some((m) => can(m.role, "configure_channel"))) redirect("/onboarding");
  const t = await getTranslations("onboarding");
  return (
    <Page>
      <EmptyState title={t("title")} description={t("noWorkspace")} className="mt-16" />
    </Page>
  );
}
