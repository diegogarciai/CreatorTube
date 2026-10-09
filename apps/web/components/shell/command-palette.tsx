"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Command } from "cmdk";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { commandIndex, type CommandEpisode } from "@/lib/actions/search";
import type { ShellChannel } from "./sidebar";

const SECTIONS = [
  "inicio",
  "ideas",
  "equipo",
  "produccion",
  "calendario",
  "audiencia",
  "boletin",
  "analitica",
  "ajustes",
] as const;
const SECTION_KEYS: Record<(typeof SECTIONS)[number], string> = {
  inicio: "home",
  ideas: "ideas",
  equipo: "gear",
  produccion: "production",
  calendario: "calendar",
  audiencia: "audience",
  boletin: "newsletter",
  analitica: "analytics",
  ajustes: "channelSettings",
};

export function CommandPalette({ channels }: { channels: ShellChannel[] }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [episodes, setEpisodes] = useState<CommandEpisode[] | null>(null);
  const channelId = /^\/c\/([^/]+)/.exec(pathname)?.[1] ?? channels[0]?.id;
  const channelName = new Map(channels.map((c) => [c.id, c.name]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open && episodes === null)
      commandIndex()
        .then(setEpisodes)
        .catch(() => setEpisodes([]));
  }, [open, episodes]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label={t("nav.command")}
      className="fixed left-1/2 top-[15vh] z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      overlayClassName="fixed inset-0 z-50 bg-black/40"
    >
      <Command.Input
        placeholder={t("command.placeholder")}
        className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
      />
      <Command.List className="max-h-[50vh] overflow-y-auto p-2 text-sm">
        <Command.Empty className="px-3 py-6 text-center text-muted">
          {t("command.empty")}
        </Command.Empty>
        {channelId ? (
          <Command.Group
            heading={t("command.navigation")}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
          >
            {SECTIONS.map((s) => (
              <Item key={s} onSelect={() => go(`/c/${channelId}/${s}`)}>
                {t(`nav.${SECTION_KEYS[s]}`)}
              </Item>
            ))}
            <Item onSelect={() => go(`/c/${channelId}/produccion?nuevo=1`)}>
              {t("production.newEpisode")}
            </Item>
            <Item onSelect={() => go("/todos")}>{t("nav.allChannels")}</Item>
          </Command.Group>
        ) : null}
        {channels.length > 1 ? (
          <Command.Group
            heading={t("command.channels")}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
          >
            {channels.map((c) => (
              <Item key={c.id} value={`canal ${c.name}`} onSelect={() => go(`/c/${c.id}/inicio`)}>
                {c.name}
              </Item>
            ))}
          </Command.Group>
        ) : null}
        {episodes && episodes.length > 0 ? (
          <Command.Group
            heading={t("command.episodes")}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
          >
            {episodes.map((e) => (
              <Item
                key={e.id}
                value={`${e.code} ${e.number} ${e.title} ${e.id}`}
                onSelect={() => go(`/c/${e.channelId}/episodios/${e.id}`)}
              >
                <FileText className="size-4 shrink-0 text-muted" />
                <span className="truncate">{e.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted">
                  {channels.length > 1 ? `${channelName.get(e.channelId)} · ` : ""}#{e.number}
                </span>
              </Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
}

function Item({
  children,
  onSelect,
  value,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  value?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 aria-selected:bg-surface-muted"
    >
      {children}
    </Command.Item>
  );
}
