"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { canChangeStatus, EPISODE_STATUSES, type EpisodeStatus, type Role } from "@planificador/core";
import { changeEpisodeStatus } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";
import { cn } from "@/lib/utils";
import { EpisodeCard } from "./episode-card";
import type { ProductionEpisode } from "./types";

/**
 * Tablero con los 6 estados. Arrastre con ratón, teclado y pantalla táctil
 * (mantener presionado 200 ms para arrastrar sin bloquear el desplazamiento).
 */
export function Board({ episodes, channelId, role }: { episodes: ProductionEpisode[]; channelId: string; role: Role }) {
  const t = useTranslations();
  const errorText = useActionError();
  const [items, setItems] = useState(episodes);
  const [source, setSource] = useState(episodes);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, start] = useTransition();
  // Datos nuevos del servidor reemplazan el estado optimista.
  if (source !== episodes) {
    setSource(episodes);
    setItems(episodes);
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const active = items.find((e) => e.id === activeId) ?? null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const to = e.over?.id as EpisodeStatus | undefined;
    const ep = items.find((x) => x.id === e.active.id);
    if (!to || !ep || ep.status === to) return;
    if (!canChangeStatus(role, ep.status, to)) {
      toast.error(t("production.moveDenied"));
      return;
    }
    const previous = items;
    setItems((list) => list.map((x) => (x.id === ep.id ? { ...x, status: to } : x)));
    start(async () => {
      const res = await changeEpisodeStatus(ep.id, to);
      if (!res.ok) {
        setItems(previous);
        toast.error(errorText(res.error));
      }
    });
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {EPISODE_STATUSES.map((status) => (
          <Column key={status} status={status} title={t(`status.${status}`)} emptyText={t("production.emptyColumn")}>
            {items
              .filter((e) => e.status === status)
              .map((e) => (
                <DraggableCard key={e.id} episode={e} channelId={channelId} hidden={e.id === activeId} />
              ))}
          </Column>
        ))}
      </div>
      <DragOverlay>{active ? <EpisodeCard episode={active} channelId={channelId} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, title, emptyText, children }: { status: EpisodeStatus; title: string; emptyText: string; children: React.ReactNode[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={title}
      className={cn(
        "flex w-72 shrink-0 snap-start flex-col rounded-xl border border-border bg-surface-muted/60 p-2 transition-colors",
        isOver && "border-accent bg-accent-soft",
      )}
    >
      <h2 className="flex items-center justify-between px-1.5 pb-2 pt-1 text-sm font-semibold">
        {title} <span className="text-xs font-normal text-muted">{children.length}</span>
      </h2>
      <div className="flex min-h-24 flex-1 flex-col gap-2">
        {children.length ? children : <p className="px-2 py-6 text-center text-xs text-muted">{emptyText}</p>}
      </div>
    </section>
  );
}

function DraggableCard({ episode, channelId, hidden }: { episode: ProductionEpisode; channelId: string; hidden: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: episode.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-manipulation", hidden && "opacity-30")}>
      <EpisodeCard episode={episode} channelId={channelId} />
    </div>
  );
}
