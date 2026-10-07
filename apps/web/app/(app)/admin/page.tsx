import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InviteForm } from "@/components/workspace/invite-form";
import { RevokeInvitationButton } from "@/components/workspace/member-row";
import { isPlatformAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Administración" };

export default async function AdminPage() {
  if (!(await isPlatformAdmin())) notFound();
  const t = await getTranslations("admin");
  const tw = await getTranslations("workspace");
  const admin = createAdminClient();
  const [{ data: workspaces }, { data: invitations }] = await Promise.all([
    admin.from("workspaces").select("id, name, created_at, channels(count), memberships(count)").order("created_at", { ascending: false }),
    admin
      .from("invitations")
      .select("id, email, expires_at, accepted_at")
      .eq("kind", "platform")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const fmt = new Intl.DateTimeFormat("es", { dateStyle: "medium" });

  return (
    <Page>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t("inviteCreator")} description={t("inviteCreatorDesc")} />
          <CardBody>
            <InviteForm />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("invitations")} />
          <ul className="divide-y divide-border">
            {(invitations ?? []).map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="flex-1">{i.email}</span>
                <span className="text-xs text-muted">
                  {i.accepted_at ? fmt.format(new Date(i.accepted_at)) : tw("expires", { date: fmt.format(new Date(i.expires_at)) })}
                </span>
                {!i.accepted_at ? <RevokeInvitationButton invitationId={i.id} /> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={t("workspaces")} />
          <ul className="divide-y divide-border">
            {(workspaces ?? []).map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="flex-1 font-medium">{w.name}</span>
                <span className="text-muted">{t("channels", { count: w.channels?.[0]?.count ?? 0 })}</span>
                <span className="text-muted">{t("members", { count: w.memberships?.[0]?.count ?? 0 })}</span>
                <span className="text-xs text-muted">{fmt.format(new Date(w.created_at))}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
