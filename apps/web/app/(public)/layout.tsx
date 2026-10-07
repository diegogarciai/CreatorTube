import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@planificador/config";
import { Logo } from "@/components/logo";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("landing");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo /> {BRAND.name}
        </Link>
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">
          {t("cta")}
        </Link>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {BRAND.name}
          </span>
          <nav className="flex gap-4">
            <Link href="/privacidad" className="hover:text-text">
              {t("privacy")}
            </Link>
            <Link href="/terminos" className="hover:text-text">
              {t("terms")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
