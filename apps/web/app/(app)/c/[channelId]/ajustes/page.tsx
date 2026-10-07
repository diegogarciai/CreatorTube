import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyField } from "@/components/copy-field";
import { ChecklistEditor } from "@/components/settings/checklist-editor";
import { ConnectionPanel, RegenerateIcsButton } from "@/components/settings/connection-panel";
import { PillarsEditor } from "@/components/settings/pillars-editor";
import { ProfileForm } from "@/components/settings/profile-form";
import { RhythmForm } from "@/components/settings/rhythm-form";
import { getChannelContext, getSupabase } from "@/lib/auth";
import { channelProfile, channelRhythm } from "@/lib/data/channel";
import { getChecklistSteps, getPillars } from "@/lib/data/queries";
import { env, YOUTUBE_CONFIGURED } from "@/lib/env";

export const metadata: Metadata = { title: "Configuración del canal" };

export default async function SettingsPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("settings");
  const supabase = await getSupabase();
  const [pillars, steps, { data: conn }] = await Promise.all([
    getPillars(channelId, true),
    getChecklistSteps(channelId),
    supabase.rpc("channel_connection_info", { ch: channelId }),
  ]);
  const canConfigure = ctx.can("configure_channel");
  const connection = conn?.[0] ?? null;
  const fmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.channel.timezone });
  const icsUrl = `${env.appUrl}/api/ics/${ctx.channel.ics_token}.ics`;

  return (
    <Page>
      <PageHeader title={t("title")} description={canConfigure ? ctx.channel.name : t("readOnly")} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t("youtube")} description={t("youtubeDesc")} />
          <CardBody>
            <ConnectionPanel
              channelId={channelId}
              status={connection?.status ?? null}
              lastSync={connection?.last_synced_at ? fmt.format(new Date(connection.last_synced_at)) : null}
              lastError={connection?.last_error ?? null}
              youtubeConfigured={YOUTUBE_CONFIGURED()}
              canConfigure={canConfigure}
              canDisconnect={ctx.can("manage_workspace")}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("profile")} description={t("profileDesc")} />
          <CardBody>
            <ProfileForm channelId={channelId} initial={channelProfile(ctx.channel)} disabled={!canConfigure} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("rhythm")} description={t("rhythmDesc")} />
          <CardBody>
            <RhythmForm channelId={channelId} initial={channelRhythm(ctx.channel)} disabled={!canConfigure} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("pillars")} description={t("pillarsDesc")} />
          <CardBody>
            <PillarsEditor
              channelId={channelId}
              disabled={!canConfigure}
              pillars={pillars.map((p) => ({ id: p.id, name: p.name, description: p.description, color: p.color, archived: Boolean(p.archived_at) }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("checklist")} description={t("checklistDesc")} />
          <CardBody>
            <ChecklistEditor
              channelId={channelId}
              disabled={!canConfigure}
              steps={steps.map((s) => ({ id: s.id, label: s.label, phase: s.phase, position: s.position, archived: s.archivedAt !== null }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("calendar")} description={t("calendarDesc")} action={canConfigure ? <RegenerateIcsButton channelId={channelId} /> : null} />
          <CardBody>
            <CopyField value={icsUrl} label={t("calendar")} />
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
