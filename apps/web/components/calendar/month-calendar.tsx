"use client";

import Link from "next/link";
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
} from "@dnd-kit/core";
import type { EpisodeStatus } from "@planificador/core";
import { rescheduleEpisode } from "@/lib/actions/episodes";
import { useActionError } from "@/lib/use-action-error";
import { cn } from "@/lib/utils";
import { STATUS_DOT } from "./status-dot";

export interface CalendarEpisode {
  id: string;
  number: number;
  title: string;
  status: EpisodeStatus;
  publishDate: string | null;
  recordDate: string | null;
}

type Kind = "publish" | "record";
const dragId = (id: string, kind: Kind) => `${kind}:${id}`;
const UNSCHEDULED = "unscheduled";

export function MonthCalendar({
  weeks,
  month,
  today,
  episodes,
  channelId,
  canEdit,
}: {
  weeks: string[][];
  month: string;
  today: string;
  episodes: CalendarEpisode[];
  channelId: string;
  canEdit: boolean;
}) {
  const t = useTranslations();
  const errorText = useActionError();
  const [items, setItems] = useState(episodes);
  const [source, setSource] = useState(episodes);
  const [active, setActive] = useState<{ ep: CalendarEpisode; kind: Kind } | null>(null);
  const [, start] = useTransition();
  if (source !== episodes) {
    setSource(episodes);
    setItems(episodes);
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    if (!e.over) return;
    const [kind, id] = String(e.active.id).split(":") as [Kind, string];
    const target = String(e.over.id);
    const date = target === UNSCHEDULED ? null : target;
    const ep = items.find((x) => x.id === id);
    if (!ep) return;
    const field = kind === "publish" ? "publishDate" : "recordDate";
    if (ep[field] === date) return;
    const previous = items;
    setItems((list) => list.map((x) => (x.id === id ? { ...x, [field]: date } : x)));
    start(async () => {
      const res = await rescheduleEpisode(id, date, kind);
      if (!res.ok) {
        setItems(previous);
        toast.error(errorText(res.error));
      }
    });
  }

  const byDay = new Map<string, { ep: CalendarEpisode; kind: Kind }[]>();
  for (const ep of items) {
    if (ep.publishDate)
      byDay.set(ep.publishDate, [...(byDay.get(ep.publishDate) ?? []), { ep, kind: "publish" }]);
    if (ep.recordDate && ["planned", "script", "to_record"].includes(ep.status)) {
      byDay.set(ep.recordDate, [...(byDay.get(ep.recordDate) ?? []), { ep, kind: "record" }]);
    }
  }
  const unscheduled = items.filter((e) => !e.publishDate && e.status !== "published");

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => {
        const [kind, id] = String(e.active.id).split(":") as [Kind, string];
        const ep = items.find((x) => x.id === id);
        if (ep) setActive({ ep, kind });
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="grid gap-6 xl:grid-cols-[1fr_260px]">
        <div className="overflow-x-auto">
          <div className="min-w-[720px] overflow-hidden rounded-xl border border-border bg-surface">
            <div className="grid grid-cols-7 border-b border-border bg-surface-muted/60 text-xs font-medium text-muted">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <div key={d} className="px-2 py-2">
                  {t(`weekdayShort.${d}`)}
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div
                key={week[0]}
                className="grid grid-cols-7 border-b border-border last:border-b-0"
              >
                {week.map((day) => (
                  <Day key={day} day={day} inMonth={day.startsWith(month)} isToday={day === today}>
                    {(byDay.get(day) ?? []).map(({ ep, kind }) => (
                      <Chip
                        key={dragId(ep.id, kind)}
                        ep={ep}
                        kind={kind}
                        channelId={channelId}
                        disabled={!canEdit}
                        hidden={active?.ep.id === ep.id && active.kind === kind}
                      />
                    ))}
                  </Day>
                ))}
              </div>
            ))}
          </div>
        </div>
        <Unscheduled title={t("calendar.unscheduled")} empty={t("calendar.unscheduledEmpty")}>
          {unscheduled.map((ep) => (
            <Chip
              key={ep.id}
              ep={ep}
              kind="publish"
              channelId={channelId}
              disabled={!canEdit}
              hidden={active?.ep.id === ep.id}
            />
          ))}
        </Unscheduled>
      </div>
      <DragOverlay>{active ? <ChipBody ep={active.ep} kind={active.kind} /> : null}</DragOverlay>
    </DndContext>
  );
}

function Day({
  day,
  inMonth,
  isToday,
  children,
}: {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-28 border-r border-border p-1.5 last:border-r-0",
        !inMonth && "bg-surface-muted/40 text-muted",
        isOver && "bg-accent-soft",
      )}
    >
      <div
        className={cn(
          "mb-1 flex size-6 items-center justify-center rounded-full text-xs",
          isToday && "bg-accent font-semibold text-accent-text",
        )}
      >
        {Number(day.slice(8))}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Unscheduled({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULED });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "rounded-xl border border-border bg-surface p-3",
        isOver && "border-accent bg-accent-soft",
      )}
    >
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="space-y-1">
        {children.length ? children : <p className="text-xs text-muted">{empty}</p>}
      </div>
    </section>
  );
}

function ChipBody({ ep, kind }: { ep: CalendarEpisode; kind: Kind }) {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded-md border px-1.5 py-1 text-xs leading-snug",
        kind === "publish"
          ? "border-border bg-surface"
          : "border-dashed border-border bg-surface-muted",
      )}
    >
      <span className={cn("mt-1 size-2 shrink-0 rounded-full", STATUS_DOT[ep.status])} />
      <span className="line-clamp-2">
        {kind === "record" ? "● " : ""}
        {ep.title}
      </span>
    </div>
  );
}

function Chip({
  ep,
  kind,
  channelId,
  disabled,
  hidden,
}: {
  ep: CalendarEpisode;
  kind: Kind;
  channelId: string;
  disabled: boolean;
  hidden: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: dragId(ep.id, kind), disabled });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("touch-manipulation", hidden && "opacity-30")}
    >
      <Link href={`/c/${channelId}/episodios/${ep.id}`} title={ep.title} draggable={false}>
        <ChipBody ep={ep} kind={kind} />
      </Link>
    </div>
  );
}
