import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@planificador/config";
import { Logo } from "@/components/logo";
import { SUPABASE_CONFIGURED } from "@/lib/env";
import { getUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const t = await getTranslations("auth");
  const configured = SUPABASE_CONFIGURED();
  if (configured && (await getUser())) redirect(safeNext(next));

  const errorText =
    !configured || error === "config"
      ? t("configMissing")
      : error === "signup"
        ? t("signupBlocked")
        : error
          ? t("callbackError")
          : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <Link href="/" className="mb-8 flex items-center gap-2 font-semibold">
        <Logo /> {BRAND.name}
      </Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      {errorText ? (
        <p role="alert" className="mt-4 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
          {errorText}
        </p>
      ) : null}
      <LoginForm next={safeNext(next)} disabled={!configured} />
      <p className="mt-6 text-xs text-muted">{t("inviteOnly")}</p>
    </main>
  );
}
