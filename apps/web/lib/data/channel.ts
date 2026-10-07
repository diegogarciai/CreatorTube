import { FORMATS, type EpisodeFormat } from "@planificador/core";
import type { Tables } from "@planificador/db";
import type { ProfileValues } from "@/components/settings/profile-form";
import type { RhythmValues } from "@/components/settings/rhythm-form";

export function channelProfile(c: Tables<"channels">): ProfileValues {
  const profile = (c.profile ?? {}) as { hosts?: string[]; audience?: string; tone?: string };
  return {
    name: c.name,
    language: c.language,
    timezone: c.timezone,
    codePrefix: c.code_prefix,
    hosts: profile.hosts ?? [],
    audience: profile.audience ?? "",
    tone: profile.tone ?? "",
  };
}

export function channelRhythm(c: Tables<"channels">): RhythmValues {
  return {
    weeklyGoal: c.weekly_goal,
    publishWeekdays: c.publish_weekdays,
    recordWeekdays: c.record_weekdays,
    formats: c.formats.filter((f): f is EpisodeFormat =>
      (FORMATS as readonly string[]).includes(f),
    ),
  };
}
