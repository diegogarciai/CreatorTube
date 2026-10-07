import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/page-header";
import { Step } from "@/components/onboarding-step";
import { ProfileForm } from "@/components/settings/profile-form";
import { RhythmForm } from "@/components/settings/rhythm-form";
import { SubmitButton } from "@/components/submit-button";
import { getChannelContext } from "@/lib/auth";
import { channelProfile, channelRhythm } from "@/lib/data/channel";
import { completeOnboarding } from "@/lib/actions/channels";

export const metadata: Metadata = { title: "Puesta en marcha" };

export default async function ChannelOnboardingPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("onboarding");
  const disabled = !ctx.can("configure_channel");
  return (
    <Page>
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t("title")} description={t("subtitle")} />
        <ol className="space-y-4">
          <Step
            n={1}
            title={t("step1")}
            description={ctx.channel.youtube_channel_id ? ctx.channel.name : t("step1Desc")}
            done
          />
          <Step n={2} title={t("step2")} description={t("step2Desc")} active>
            <div className="space-y-8">
              <ProfileForm
                channelId={channelId}
                initial={channelProfile(ctx.channel)}
                disabled={disabled}
              />
              <hr className="border-border" />
              <RhythmForm
                channelId={channelId}
                initial={channelRhythm(ctx.channel)}
                disabled={disabled}
              />
            </div>
          </Step>
          <Step n={3} title={t("step3")} description={t("step3Desc")} />
        </ol>
        <form action={completeOnboarding.bind(null, channelId)} className="mt-6 flex justify-end">
          <SubmitButton size="lg" disabled={disabled}>
            {t("finish")}
          </SubmitButton>
        </form>
      </div>
    </Page>
  );
}
