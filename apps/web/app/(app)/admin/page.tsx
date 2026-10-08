import type { Metadata } from "next";
import { AI_STAGES, isAiStage, type AiStage } from "@planificador/ai";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InviteForm } from "@/components/workspace/invite-form";
import { CreateOwnWorkspaceCard } from "@/components/workspace/no-workspace";
import { CreditsQuotaForm } from "@/components/workspace/credits";
import {
  AiModelsCatalog,
  WorkspaceAiForm,
  type AiModelRow,
  type WorkspaceAiRow,
} from "@/components/workspace/ai-models";
import { JobTestButton } from "@/components/workspace/job-test";
import { JOBS_CONFIGURED } from "@/lib/jobs";
import { RevokeInvitationButton } from "@/components/workspace/member-row";
import { isPlatformAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { usd } from "@/lib/utils";

export const metadata: Metadata = { title: "Administración" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (!(await isPlatformAdmin())) notFound();
  const t = await getTranslations("admin");
  const tw = await getTranslations("workspace");
  const admin = createAdminClient();
  const [{ data: workspaces }, { data: invitations }, { data: modelRows }, { data: aiRows }] =
    await Promise.all([
      admin
        .from("workspaces")
        .select("id, name, created_at, monthly_credits, channels(count), memberships(count)")
        .order("created_at", { ascending: false }),
      admin
        .from("invitations")
        .select("id, email, expires_at, accepted_at")
        .eq("kind", "platform")
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("ai_models")
        .select("id, display_name, available, input_price_usd, output_price_usd, created_at_api")
        .order("available", { ascending: false })
        .order("created_at_api", { ascending: false, nullsFirst: false }),
      admin.from("workspace_ai_settings").select("workspace_id, default_model, stage_models"),
    ]);
  const models: AiModelRow[] = (modelRows ?? []).map((m) => ({
    id: m.id,
    displayName: m.display_name,
    available: m.available,
    inputPrice: m.input_price_usd === null ? null : Number(m.input_price_usd),
    outputPrice: m.output_price_usd === null ? null : Number(m.output_price_usd),
  }));
  const aiByWorkspace = new Map<string, WorkspaceAiRow>(
    (aiRows ?? []).map((r) => [
      r.workspace_id,
      {
        defaultModel: r.default_model,
        stageModels: Object.fromEntries(
          Object.entries((r.stage_models ?? {}) as Record<string, unknown>).filter(
            (e): e is [AiStage, string] => isAiStage(e[0]) && typeof e[1] === "string",
          ),
        ),
      },
    ]),
  );
  const fmt = new Intl.DateTimeFormat("es", { dateStyle: "medium" });
  const balances = new Map(
    await Promise.all(
      (workspaces ?? []).map(async (w) => {
        const { data } = await admin.rpc("workspace_credits", { ws: w.id });
        return [w.id, Number(data?.[0]?.used ?? 0)] as const;
      }),
    ),
  );

  return (
    <Page>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="space-y-6">
        {error ? (
          <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
            {error}
          </p>
        ) : null}
        <Card>
          <CardHeader title={t("inviteCreator")} description={t("inviteCreatorDesc")} />
          <CardBody>
            <InviteForm />
          </CardBody>
        </Card>
        <CreateOwnWorkspaceCard from="/admin" />
        <Card>
          <CardHeader title={t("jobs")} description={t("jobsDesc")} />
          <CardBody className="space-y-2">
            {JOBS_CONFIGURED() ? null : <p className="text-sm text-warn">{t("jobsMissing")}</p>}
            <JobTestButton disabled={!JOBS_CONFIGURED()} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("aiModels")} description={t("aiModelsDesc")} />
          <CardBody>
            <AiModelsCatalog models={models} jobsConfigured={JOBS_CONFIGURED()} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("invitations")} />
          <ul className="divide-y divide-border">
            {(invitations ?? []).map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="flex-1">{i.email}</span>
                <span className="text-xs text-muted">
                  {i.accepted_at
                    ? fmt.format(new Date(i.accepted_at))
                    : tw("expires", { date: fmt.format(new Date(i.expires_at)) })}
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
                <span className="text-muted">
                  {t("channels", { count: w.channels?.[0]?.count ?? 0 })}
                </span>
                <span className="text-muted">
                  {t("members", { count: w.memberships?.[0]?.count ?? 0 })}
                </span>
                <span className="text-xs text-muted">{fmt.format(new Date(w.created_at))}</span>
                <span className="w-full text-xs text-muted sm:w-auto">
                  {t("creditsUsed", { used: usd(balances.get(w.id) ?? 0) })}
                </span>
                <CreditsQuotaForm workspaceId={w.id} monthly={w.monthly_credits} />
                <WorkspaceAiForm
                  workspaceId={w.id}
                  models={models}
                  settings={aiByWorkspace.get(w.id) ?? null}
                  stages={AI_STAGES}
                />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
