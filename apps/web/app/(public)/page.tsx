import Link from "next/link";
import { CalendarCheck, ListChecks, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui/button";

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const features = [
    { icon: ListChecks, title: t("feature1Title"), text: t("feature1") },
    { icon: CalendarCheck, title: t("feature2Title"), text: t("feature2") },
    { icon: Users, title: t("feature3Title"), text: t("feature3") },
  ];
  return (
    <div className="mx-auto max-w-5xl px-6">
      <section className="py-16 sm:py-24">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t("subtitle")}</p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/login" className={buttonClass("primary", "lg")}>
            {t("cta")}
          </Link>
          <span className="text-sm text-muted">{t("inviteOnly")}</span>
        </div>
      </section>
      <section className="grid gap-4 pb-16 sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-surface p-5">
            <f.icon className="size-5 text-accent" />
            <h2 className="mt-3 font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-muted">{f.text}</p>
          </div>
        ))}
      </section>
      <p className="pb-10 text-xs text-muted">{t("googleNotice")}</p>
    </div>
  );
}
