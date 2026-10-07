import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold">{t("errors.notFoundTitle")}</h1>
      <p className="mt-2 text-muted">{t("errors.notFoundDesc")}</p>
      <Link href="/app" className={buttonClass("secondary", "md", "mt-6")}>
        {t("nav.home")}
      </Link>
    </main>
  );
}
