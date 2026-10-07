import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@planificador/config";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { SubmitButton } from "@/components/submit-button";
import { getUser } from "@/lib/auth";
import { SUPABASE_CONFIGURED } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { acceptInvitation } from "@/lib/actions/invitations";

export const metadata: Metadata = { title: "Invitación" };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const t = await getTranslations();
  if (!SUPABASE_CONFIGURED()) {
    return <Shell>{t("auth.configMissing")}</Shell>;
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc("invitation_preview", { token });
  const invite = data?.[0];
  const user = await getUser();

  if (!invite) return <Shell>{t("invite.notFound")}</Shell>;
  if (invite.accepted) return <Shell>{t("invite.accepted")}</Shell>;
  if (invite.expired) return <Shell>{t("invite.expired")}</Shell>;

  return (
    <Shell>
      <p className="text-base text-text">
        {invite.kind === "platform"
          ? t("invite.platform")
          : t("invite.workspace", { workspace: invite.workspace_name, role: t(`role.${invite.role}`) })}
      </p>
      <p className="mt-1">{t("invite.forEmail", { email: invite.email_hint })}</p>
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-critical-soft px-3 py-2 text-critical">
          {error}
        </p>
      ) : null}
      {user ? (
        <form action={acceptInvitation.bind(null, token)} className="mt-6 space-y-4">
          {invite.kind === "platform" ? (
            <div>
              <Label htmlFor="workspaceName">{t("invite.workspaceName")}</Label>
              <Input id="workspaceName" name="workspaceName" placeholder={t("invite.workspaceNamePlaceholder")} required />
            </div>
          ) : null}
          <SubmitButton className="w-full">{t("invite.accept")}</SubmitButton>
        </form>
      ) : (
        <div className="mt-6">
          <p>{t("invite.loginFirst")}</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className={buttonClass("primary", "md", "mt-4 w-full")}
          >
            {t("auth.title")}
          </Link>
        </div>
      )}
    </Shell>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("invite");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <Link href="/" className="mb-8 flex items-center gap-2 font-semibold">
        <Logo /> {BRAND.name}
      </Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <div className="mt-3 text-sm text-muted">{children}</div>
    </main>
  );
}
