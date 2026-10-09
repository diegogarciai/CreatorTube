"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  Home,
  LayoutGrid,
  Lightbulb,
  LogOut,
  Mail,
  Package,
  Menu,
  MessagesSquare,
  Plus,
  Search,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";
import { BRAND } from "@planificador/config";
import { Logo } from "@/components/logo";
import { TaskTray } from "@/components/shell/task-tray";
import { cn } from "@/lib/utils";

export interface ShellChannel {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  workspaceId: string;
}

export interface ShellWorkspace {
  id: string;
  name: string;
  canManage: boolean;
}

const SECTIONS = [
  { slug: "inicio", key: "home", icon: Home },
  { slug: "ideas", key: "ideas", icon: Lightbulb },
  { slug: "equipo", key: "gear", icon: Package },
  { slug: "produccion", key: "production", icon: Clapperboard },
  { slug: "calendario", key: "calendar", icon: CalendarDays },
  { slug: "audiencia", key: "audience", icon: MessagesSquare },
  { slug: "boletin", key: "newsletter", icon: Mail },
  { slug: "analitica", key: "analytics", icon: BarChart3 },
] as const;

export function Sidebar({
  channels,
  workspaces,
  isAdmin,
  userEmail,
}: {
  channels: ShellChannel[];
  workspaces: ShellWorkspace[];
  isAdmin: boolean;
  userEmail: string;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const match = /^\/c\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  const channelId = match?.[1] ?? null;
  const section = match?.[2] ?? null;
  const current = channels.find((c) => c.id === channelId) ?? null;

  // Cerrar menús al navegar.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
    setSwitcher(false);
  }

  useEffect(() => {
    if (channelId)
      document.cookie = `last_channel=${channelId}; path=/; max-age=31536000; samesite=lax`;
  }, [channelId]);

  const nav = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="flex items-center justify-between px-2 pb-3">
        <Link href="/app" className="flex items-center gap-2 font-semibold">
          <Logo size={22} /> {BRAND.name}
        </Link>
        <button
          className="rounded p-1 text-muted lg:hidden"
          onClick={() => setOpen(false)}
          aria-label={t("menu")}
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="relative">
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-sm hover:bg-surface-muted"
          onClick={() => setSwitcher((v) => !v)}
          aria-expanded={switcher}
        >
          <ChannelAvatar channel={current} />
          <span className="flex-1 truncate font-medium">{current?.name ?? t("allChannels")}</span>
          <ChevronDown className="size-4 text-muted" />
        </button>
        {switcher ? (
          <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-lg border border-border bg-surface p-1 shadow-lg">
            <Link
              href="/todos"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted"
            >
              <LayoutGrid className="size-4 text-muted" /> {t("allChannels")}
            </Link>
            <div className="my-1 h-px bg-border" />
            {channels.map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.id}/${section && section !== "episodios" ? section : "inicio"}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted",
                  c.id === channelId && "bg-surface-muted font-medium",
                )}
              >
                <ChannelAvatar channel={c} /> <span className="truncate">{c.name}</span>
              </Link>
            ))}
            {workspaces.some((w) => w.canManage) ? (
              <Link
                href="/onboarding"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-accent hover:bg-surface-muted"
              >
                <Plus className="size-4" /> {t("addChannel")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-surface-muted"
        onClick={() => window.dispatchEvent(new Event("open-command"))}
      >
        <Search className="size-4" /> <span className="flex-1 text-left">{t("command")}</span>
        <kbd className="rounded border border-border px-1.5 text-[10px]">Ctrl K</kbd>
      </button>

      <div className="mt-2 space-y-0.5">
        {channelId
          ? SECTIONS.map((s) => (
              <Link
                key={s.slug}
                href={`/c/${channelId}/${s.slug}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted",
                  (section === s.slug || (s.slug === "produccion" && section === "episodios")) &&
                    "bg-accent-soft font-medium text-accent",
                )}
              >
                <s.icon className="size-4" /> {t(s.key)}
              </Link>
            ))
          : null}
      </div>

      <div className="mt-auto pb-3 empty:pb-0">
        <TaskTray />
      </div>
      <div className="space-y-0.5 border-t border-border pt-3">
        {channelId ? (
          <Link
            href={`/c/${channelId}/ajustes`}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted",
              section === "ajustes" && "bg-surface-muted font-medium",
            )}
          >
            <Settings className="size-4" /> {t("channelSettings")}
          </Link>
        ) : null}
        {(current ? workspaces.filter((w) => w.id === current.workspaceId) : workspaces).map(
          (w) => (
            <Link
              key={w.id}
              href={`/espacio/${w.id}`}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted"
            >
              <Users className="size-4" />{" "}
              <span className="truncate">{workspaces.length > 1 ? w.name : t("workspace")}</span>
            </Link>
          ),
        )}
        {isAdmin ? (
          <Link
            href="/admin"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted"
          >
            <Shield className="size-4" /> {t("admin")}
          </Link>
        ) : null}
        <form action="/auth/signout" method="post">
          <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-surface-muted">
            <LogOut className="size-4" />{" "}
            <span className="flex-1 truncate text-left">{t("signOut")}</span>
          </button>
        </form>
        <p className="truncate px-2.5 text-xs text-muted" title={userEmail}>
          {userEmail}
        </p>
      </div>
    </nav>
  );

  return (
    <>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
        <button onClick={() => setOpen(true)} aria-label={t("menu")}>
          <Menu className="size-5" />
        </button>
        <span className="truncate font-medium">{current?.name ?? BRAND.name}</span>
      </header>
      {open ? (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 h-dvh w-64 overflow-y-auto border-r border-border bg-surface transition-transform lg:sticky lg:top-0 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {nav}
      </aside>
    </>
  );
}

function ChannelAvatar({ channel }: { channel: ShellChannel | null }) {
  if (channel?.thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={channel.thumbnailUrl} alt="" className="size-6 rounded-full" />;
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
      {channel ? channel.name.slice(0, 1).toUpperCase() : <LayoutGrid className="size-3.5" />}
    </span>
  );
}
