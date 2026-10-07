"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { updateChannelProfile } from "@/lib/actions/channels";
import { useActionError } from "@/lib/use-action-error";

export interface ProfileValues {
  name: string;
  language: string;
  timezone: string;
  codePrefix: string;
  hosts: string[];
  audience: string;
  tone: string;
}

const LANGUAGES = [
  ["es", "Español"],
  ["en", "English"],
  ["pt", "Português"],
  ["fr", "Français"],
] as const;

export function ProfileForm({
  channelId,
  initial,
  disabled,
}: {
  channelId: string;
  initial: ProfileValues;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [values, setValues] = useState({ ...initial, hostsText: initial.hosts.join(", ") });
  const [pending, start] = useTransition();
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [initial.timezone];
  const set =
    (k: keyof typeof values) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateChannelProfile(channelId, {
        name: values.name,
        language: values.language,
        timezone: values.timezone,
        codePrefix: values.codePrefix,
        hosts: values.hostsText
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean),
        audience: values.audience,
        tone: values.tone,
      });
      if (res.ok) toast.success(t("common.saved"));
      else toast.error(errorText(res.error));
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={disabled || pending} className="contents">
        <Field label={t("settings.name")} htmlFor="p-name">
          <Input id="p-name" value={values.name} onChange={set("name")} required maxLength={120} />
        </Field>
        <Field label={t("settings.language")} htmlFor="p-lang">
          <Select id="p-lang" value={values.language} onChange={set("language")}>
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.timezone")} htmlFor="p-tz">
          <Select id="p-tz" value={values.timezone} onChange={set("timezone")}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("settings.codePrefix")}
          hint={t("settings.codePrefixHint")}
          htmlFor="p-prefix"
        >
          <Input
            id="p-prefix"
            value={values.codePrefix}
            onChange={(e) => setValues((v) => ({ ...v, codePrefix: e.target.value.toUpperCase() }))}
            maxLength={6}
            pattern="[A-Za-z0-9]{1,6}"
          />
        </Field>
        <Field label={t("settings.hosts")} htmlFor="p-hosts" className="sm:col-span-2">
          <Input
            id="p-hosts"
            value={values.hostsText}
            onChange={set("hostsText")}
            placeholder={t("settings.hostsPlaceholder")}
          />
        </Field>
        <Field label={t("settings.audience")} htmlFor="p-aud">
          <Textarea
            id="p-aud"
            value={values.audience}
            onChange={set("audience")}
            maxLength={1000}
          />
        </Field>
        <Field label={t("settings.tone")} htmlFor="p-tone">
          <Textarea id="p-tone" value={values.tone} onChange={set("tone")} maxLength={1000} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit">{pending ? t("common.saving") : t("common.save")}</Button>
        </div>
      </fieldset>
    </form>
  );
}
