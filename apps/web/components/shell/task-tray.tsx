"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import type { Tables } from "@planificador/db";
import { createClient } from "@/lib/supabase/browser";
import { useActionError } from "@/lib/use-action-error";
import { cn } from "@/lib/utils";

type TaskRow = Pick<
  Tables<"tasks">,
  "id" | "kind" | "status" | "progress" | "message" | "error" | "created_at" | "finished_at"
>;

const COLUMNS = "id, kind, status, progress, message, error, created_at, finished_at";
/** Lo terminado se ve 10 minutos; lo que corre, siempre. */
const RECENT_MS = 10 * 60 * 1000;

/**
 * Bandeja de tareas largas: lo que corre en los espacios de la persona, en
 * vivo con Supabase Realtime (las políticas de RLS de `tasks` filtran qué ve).
 */
export function TaskTray() {
  const t = useTranslations();
  const errorText = useActionError();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    supabase
      .from("tasks")
      .select(COLUMNS)
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => alive && data && setRows(data));

    const channel = supabase
      .channel("task-tray")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (change) => {
        const row = change.new as TaskRow;
        if (!row?.id) return;
        setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)].slice(0, 10));
      })
      .subscribe();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  const visible = rows.filter(
    (r) =>
      r.status === "queued" ||
      r.status === "running" ||
      now - new Date(r.finished_at ?? r.created_at).getTime() < RECENT_MS,
  );
  if (visible.length === 0) return null;

  return (
    <section
      aria-label={t("tasks.title")}
      className="space-y-2 rounded-lg border border-border p-2.5"
    >
      <h2 className="text-xs font-medium text-muted">{t("tasks.title")}</h2>
      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id} className="space-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              {r.status === "succeeded" ? (
                <CheckCircle2 className="size-3.5 text-ok" />
              ) : r.status === "failed" || r.status === "canceled" ? (
                <CircleAlert className="size-3.5 text-critical" />
              ) : (
                <Loader2 className="size-3.5 animate-spin text-accent" />
              )}
              <span className="truncate font-medium">
                {t.has(`tasks.kind.${r.kind}`) ? t(`tasks.kind.${r.kind}`) : r.kind}
              </span>
            </div>
            {r.status === "failed" ? (
              <p className="text-critical">{errorText(r.error ?? "errors.unknown")}</p>
            ) : r.status === "queued" || r.status === "running" ? (
              <>
                <div className="h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                  <div
                    className={cn("h-full rounded-full bg-accent transition-[width]")}
                    style={{ width: `${Math.round((r.progress ?? 0) * 100)}%` }}
                  />
                </div>
                <p className="truncate text-muted">{r.message ?? t(`tasks.status.${r.status}`)}</p>
              </>
            ) : (
              <p className="text-muted">{t("tasks.status.succeeded")}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
