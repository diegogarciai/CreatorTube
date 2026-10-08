import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyField } from "@/components/copy-field";
import { BrandKitForm } from "@/components/settings/brand-kit-form";
import { ChecklistEditor } from "@/components/settings/checklist-editor";
import { ConnectionPanel, RegenerateIcsButton } from "@/components/settings/connection-panel";
import { PresenterPhotos } from "@/components/settings/presenter-photos";
import { PillarsEditor } from "@/components/settings/pillars-editor";
import { ProfileForm } from "@/components/settings/profile-form";
import { RhythmForm } from "@/components/settings/rhythm-form";
import { WriterGuide } from "@/components/settings/writer-guide";
import { YouTubeImport } from "@/components/settings/youtube-import";
import { DEFAULT_STAGE_SECTIONS, type GuideSection, type StageSections } from "@planificador/core";
import { getChannelContext, getSupabase } from "@/lib/auth";
import { loadBrandView } from "@/lib/data/brand";
import { channelProfile, channelRhythm } from "@/lib/data/channel";
import { getChecklistSteps, getPillars } from "@/lib/data/queries";
import { env, YOUTUBE_CONFIGURED } from "@/lib/env";

export const metadata: Metadata = { title: "Configuración del canal" };

export default async function SettingsPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const ctx = await getChannelContext(channelId);
  const t = await getTranslations("settings");
  const tImport = await getTranslations("import");
  const tBrand = await getTranslations("brand");
  const supabase = await getSupabase();
  const [pillars, steps, { data: conn }, { data: guide }, { data: versions }, brand] =
    await Promise.all([
      getPillars(channelId, true),
      getChecklistSteps(channelId),
      supabase.rpc("channel_connection_info", { ch: channelId }),
      supabase
        .from("writer_guides")
        .select("current_version_id")
        .eq("channel_id", channelId)
        .maybeSingle(),
      supabase
        .from("writer_guide_versions")
        .select(
          "id, version, notes, created_at, sections, stage_sections, author:profiles(full_name, email)",
        )
        .eq("channel_id", channelId)
        .order("version", { ascending: false }),
      loadBrandView(channelId),
    ]);
  const canConfigure = ctx.can("configure_channel");
  const connection = conn?.[0] ?? null;
  const fmt = new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.channel.timezone,
  });
  const icsUrl = `${env.appUrl}/api/ics/${ctx.channel.ics_token}.ics`;
  const guideVersions = (versions ?? []).map((v) => ({
    id: v.id,
    version: v.version,
    createdAt: fmt.format(new Date(v.created_at)),
    author: v.author?.full_name || v.author?.email || null,
    notes: v.notes,
  }));
  const currentRow = (versions ?? []).find((v) => v.id === guide?.current_version_id);
  const currentGuide = currentRow
    ? {
        ...guideVersions.find((v) => v.id === currentRow.id)!,
        sections: (currentRow.sections as unknown as GuideSection[]).map((x) => ({
          key: x.key,
          title: x.title,
          length: x.body.length,
        })),
        stageSections: {
          ...DEFAULT_STAGE_SECTIONS,
          ...(currentRow.stage_sections as Partial<StageSections>),
        },
      }
    : null;

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={canConfigure ? ctx.channel.name : t("readOnly")}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t("youtube")} description={t("youtubeDesc")} />
          <CardBody>
            <ConnectionPanel
              channelId={channelId}
              status={connection?.status ?? null}
              lastSync={
                connection?.last_synced_at ? fmt.format(new Date(connection.last_synced_at)) : null
              }
              lastError={connection?.last_error ?? null}
              youtubeConfigured={YOUTUBE_CONFIGURED()}
              canConfigure={canConfigure}
              canDisconnect={ctx.can("manage_workspace")}
            />
          </CardBody>
        </Card>
        {connection?.status === "active" && ctx.can("manage_episodes") ? (
          <Card>
            <CardHeader title={tImport("title")} description={tImport("description")} />
            <CardBody>
              <YouTubeImport channelId={channelId} timezone={ctx.channel.timezone} />
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("profile")} description={t("profileDesc")} />
          <CardBody>
            <ProfileForm
              channelId={channelId}
              initial={channelProfile(ctx.channel)}
              disabled={!canConfigure}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("rhythm")} description={t("rhythmDesc")} />
          <CardBody>
            <RhythmForm
              channelId={channelId}
              initial={channelRhythm(ctx.channel)}
              disabled={!canConfigure}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("pillars")} description={t("pillarsDesc")} />
          <CardBody>
            <PillarsEditor
              channelId={channelId}
              disabled={!canConfigure}
              pillars={pillars.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                color: p.color,
                archived: Boolean(p.archived_at),
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("checklist")} description={t("checklistDesc")} />
          <CardBody>
            <ChecklistEditor
              channelId={channelId}
              disabled={!canConfigure}
              steps={steps.map((s) => ({
                id: s.id,
                label: s.label,
                phase: s.phase,
                position: s.position,
                archived: s.archivedAt !== null,
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("writerGuide")} description={t("writerGuideDesc")} />
          <CardBody>
            <WriterGuide
              channelId={channelId}
              current={currentGuide}
              versions={guideVersions}
              disabled={!canConfigure}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={tBrand("title")} description={tBrand("description")} />
          <CardBody>
            <BrandKitForm
              channelId={channelId}
              initial={brand.kit}
              isDefault={brand.isDefault}
              logoUrl={brand.logoUrl}
              disabled={!canConfigure}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={tBrand("photos")} description={tBrand("photosDesc")} />
          <CardBody>
            <PresenterPhotos channelId={channelId} photos={brand.photos} disabled={!canConfigure} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={t("calendar")}
            description={t("calendarDesc")}
            action={canConfigure ? <RegenerateIcsButton channelId={channelId} /> : null}
          />
          <CardBody>
            <CopyField value={icsUrl} label={t("calendar")} />
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
