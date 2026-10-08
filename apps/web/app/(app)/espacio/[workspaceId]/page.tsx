import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { assignableRoles } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CreditsMeter } from "@/components/workspace/credits";
import { InviteForm } from "@/components/workspace/invite-form";
import { MemberControls, RevokeInvitationButton } from "@/components/workspace/member-row";
import { getMyChannels, getMyMemberships, getSupabase, requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Espacio y equipo" };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const me = await requireUser();
  const mine = (await getMyMemberships()).find((m) => m.workspaceId === workspaceId);
  if (!mine) notFound();
  const t = await getTranslations();
  const supabase = await getSupabase();
  const assignable = assignableRoles(mine.role);
  const canManage = assignable.length > 0;
  const [{ data: members }, { data: invitations }, channels, { data: credits }] = await Promise.all(
    [
      supabase
        .from("memberships")
        .select("user_id, role, channel_ids, profile:profiles(full_name, email)")
        .eq("workspace_id", workspaceId),
      canManage
        ? supabase
            .from("invitations")
            .select("id, email, role, expires_at")
            .eq("workspace_id", workspaceId)
            .is("accepted_at", null)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      getMyChannels(),
      supabase.rpc("workspace_credits", { ws: workspaceId }),
    ],
  );
  const balance = credits?.[0];
  const wsChannels = channels.filter((c) => c.workspace_id === workspaceId);
  const channelName = new Map(wsChannels.map((c) => [c.id, c.name]));
  const fmt = new Intl.DateTimeFormat("es", { dateStyle: "medium" });

  return (
    <Page>
      <PageHeader
        title={t("workspace.title")}
        description={canManage ? mine.workspaceName : t("workspace.readOnly")}
      />
      <div className="space-y-6">
        {balance ? (
          <Card>
            <CardHeader title={t("credits.title")} description={t("credits.desc")} />
            <CardBody>
              <CreditsMeter monthly={balance.monthly} used={Number(balance.used)} />
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("workspace.members")} />
          <ul className="divide-y divide-border">
            {(members ?? []).map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {m.profile?.full_name || m.profile?.email}
                    {m.user_id === me.id ? (
                      <span className="ml-2 text-xs text-muted">({t("workspace.you")})</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">
                    {m.profile?.email} ·{" "}
                    {m.channel_ids
                      ? m.channel_ids.map((id) => channelName.get(id) ?? "—").join(", ")
                      : t("workspace.allChannels")}
                  </p>
                </div>
                {canManage && m.user_id !== me.id ? (
                  <MemberControls
                    workspaceId={workspaceId}
                    userId={m.user_id}
                    role={m.role}
                    channelIds={m.channel_ids}
                    assignable={assignable}
                  />
                ) : (
                  <Badge>{t(`role.${m.role}`)}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {canManage ? (
          <>
            <Card>
              <CardHeader title={t("workspace.invite")} description={t("workspace.inviteDesc")} />
              <CardBody>
                <InviteForm
                  workspaceId={workspaceId}
                  roles={assignable}
                  channels={wsChannels.map((c) => ({ id: c.id, name: c.name }))}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("workspace.pending")} />
              {invitations && invitations.length > 0 ? (
                <ul className="divide-y divide-border">
                  {invitations.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                      <span className="flex-1">{i.email}</span>
                      <Badge>{t(`role.${i.role}`)}</Badge>
                      <span className="text-xs text-muted">
                        {t("workspace.expires", { date: fmt.format(new Date(i.expires_at)) })}
                      </span>
                      <RevokeInvitationButton invitationId={i.id} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-sm text-muted">{t("workspace.noPending")}</p>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </Page>
  );
}
