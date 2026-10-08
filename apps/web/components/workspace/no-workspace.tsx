import { getTranslations } from "next-intl/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/form";
import { SubmitButton } from "@/components/submit-button";
import { getSupabase, isPlatformAdmin } from "@/lib/auth";
import { acceptPendingInvitation, createOwnWorkspace } from "@/lib/actions/invitations";

type From = "/app" | "/onboarding" | "/admin";

/**
 * Pantalla de quien no tiene espacio: sus invitaciones pendientes (aunque no haya
 * entrado por el enlace) y, si administra la plataforma, crear su propio espacio.
 */
export async function NoWorkspace({ from, error }: { from: From; error?: string }) {
  const t = await getTranslations();
  const supabase = await getSupabase();
  const [{ data: pending }, admin] = await Promise.all([
    supabase.rpc("my_pending_invitations"),
    isPlatformAdmin(),
  ]);
  const invitations = pending ?? [];

  if (invitations.length === 0 && !admin) {
    return (
      <EmptyState
        title={t("onboarding.title")}
        description={t("onboarding.noWorkspace")}
        className="mt-16"
      />
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t("onboarding.title")}</h1>
      {error ? (
        <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {invitations.map((inv) => (
        <Card key={inv.id}>
          <CardHeader
            title={t("workspace.pendingForYou")}
            description={
              inv.kind === "platform"
                ? t("invite.platform")
                : t("invite.workspace", {
                    workspace: inv.workspace_name ?? "",
                    role: t(`role.${inv.role}`),
                  })
            }
          />
          <CardBody>
            <form action={acceptPendingInvitation.bind(null, inv.id)} className="space-y-3">
              <input type="hidden" name="from" value={from} />
              {inv.kind === "platform" ? <WorkspaceNameField id={`name-${inv.id}`} t={t} /> : null}
              <SubmitButton>
                {inv.kind === "platform" ? t("workspace.createOwn") : t("workspace.join")}
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      ))}
      {admin && invitations.length === 0 ? <CreateOwnWorkspaceCard from={from} /> : null}
    </div>
  );
}

/** Formulario de administrador para crear un espacio propio. */
export async function CreateOwnWorkspaceCard({ from }: { from: From }) {
  const t = await getTranslations();
  return (
    <Card>
      <CardHeader title={t("workspace.createOwn")} description={t("workspace.createOwnDesc")} />
      <CardBody>
        <form action={createOwnWorkspace} className="space-y-3">
          <input type="hidden" name="from" value={from} />
          <WorkspaceNameField id="own-workspace-name" t={t} />
          <SubmitButton>{t("workspace.createOwn")}</SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}

function WorkspaceNameField({
  id,
  t,
}: {
  id: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <div>
      <Label htmlFor={id}>{t("invite.workspaceName")}</Label>
      <Input
        id={id}
        name="workspaceName"
        placeholder={t("invite.workspaceNamePlaceholder")}
        required
        maxLength={120}
      />
    </div>
  );
}
