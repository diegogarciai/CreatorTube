import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SquarePlay } from "lucide-react";
import { can } from "@planificador/core";
import { Page, PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/submit-button";
import { Step } from "@/components/onboarding-step";
import { getMyMemberships } from "@/lib/auth";
import { YOUTUBE_CONFIGURED } from "@/lib/env";
import { createManualChannel } from "@/lib/actions/channels";

export const metadata: Metadata = { title: "Puesta en marcha" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ workspace?: string; error?: string }> }) {
  const { workspace, error } = await searchParams;
  const t = await getTranslations();
  const workspaces = (await getMyMemberships()).filter((m) => can(m.role, "configure_channel"));
  if (workspaces.length === 0) {
    return (
      <Page>
        <EmptyState title={t("onboarding.title")} description={t("onboarding.noWorkspace")} className="mt-16" />
      </Page>
    );
  }
  const selected = workspaces.find((w) => w.workspaceId === workspace) ?? workspaces[0]!;
  const youtubeReady = YOUTUBE_CONFIGURED();

  return (
    <Page>
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t("onboarding.title")} description={t("onboarding.subtitle")} />
        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
            {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.unknown")} ({error})
          </p>
        ) : null}
        {workspaces.length > 1 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {workspaces.map((w) => (
              <Link
                key={w.workspaceId}
                href={`/onboarding?workspace=${w.workspaceId}`}
                className={buttonClass(w.workspaceId === selected.workspaceId ? "primary" : "secondary", "sm")}
              >
                {w.workspaceName}
              </Link>
            ))}
          </div>
        ) : null}
        <ol className="space-y-4">
          <Step n={1} title={t("onboarding.step1")} description={t("onboarding.step1Desc")} active>
            {youtubeReady ? (
              <a href={`/api/youtube/connect?workspace=${selected.workspaceId}`} className={buttonClass("primary", "md")}>
                <SquarePlay className="size-4" /> {t("onboarding.connect")}
              </a>
            ) : (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{t("onboarding.youtubeNotConfigured")}</p>
            )}
            <details className="mt-4 text-sm" open={!youtubeReady}>
              <summary className="cursor-pointer text-muted">{t("onboarding.manual")}</summary>
              <form action={createManualChannel.bind(null, selected.workspaceId)} className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1">
                  <Label htmlFor="name">{t("onboarding.manualName")}</Label>
                  <Input id="name" name="name" required maxLength={120} />
                </div>
                <SubmitButton variant="secondary">{t("common.create")}</SubmitButton>
              </form>
            </details>
          </Step>
          <Step n={2} title={t("onboarding.step2")} description={t("onboarding.step2Desc")} />
          <Step n={3} title={t("onboarding.step3")} description={t("onboarding.step3Desc")} />
        </ol>
      </div>
    </Page>
  );
}
