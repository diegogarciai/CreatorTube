import { requireUser, getMyChannels, getMyMemberships, isPlatformAdmin } from "@/lib/auth";
import { can } from "@planificador/core";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandPalette } from "@/components/shell/command-palette";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [channels, memberships, admin] = await Promise.all([
    getMyChannels(),
    getMyMemberships(),
    isPlatformAdmin(),
  ]);
  const shellChannels = channels.map((c) => ({
    id: c.id,
    name: c.name,
    thumbnailUrl: c.thumbnail_url,
    workspaceId: c.workspace_id,
  }));
  const workspaces = memberships.map((m) => ({
    id: m.workspaceId,
    name: m.workspaceName,
    canManage: can(m.role, "configure_channel"),
  }));
  return (
    <div className="lg:flex">
      <Sidebar
        channels={shellChannels}
        workspaces={workspaces}
        isAdmin={admin}
        userEmail={user.email ?? ""}
      />
      <div className="min-w-0 flex-1">{children}</div>
      <CommandPalette channels={shellChannels} />
    </div>
  );
}
