import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@planificador/core";
import { Page } from "@/components/page-header";
import { NoWorkspace } from "@/components/workspace/no-workspace";
import { getMyChannels, getMyMemberships } from "@/lib/auth";

/** Entrada a la app: último canal usado, el primero, o la puesta en marcha. */
export default async function AppEntry({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [channels, memberships] = await Promise.all([getMyChannels(), getMyMemberships()]);
  const last = (await cookies()).get("last_channel")?.value;
  const target = channels.find((c) => c.id === last) ?? channels[0];
  if (target) {
    redirect(
      target.onboarding_completed_at ? `/c/${target.id}/inicio` : `/onboarding/canal/${target.id}`,
    );
  }
  if (memberships.some((m) => can(m.role, "configure_channel"))) redirect("/onboarding");
  const { error } = await searchParams;
  return (
    <Page>
      <NoWorkspace from="/app" error={error} />
    </Page>
  );
}
