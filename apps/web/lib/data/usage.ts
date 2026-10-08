import "server-only";
import { createAdminClient } from "../supabase/admin";
import { splitCost, stageOfKind, type UsageRow, type UsageStage } from "../usage";

/**
 * Datos del panel de consumo. Solo para el administrador de la plataforma: la
 * página lo revisa antes de llamar aquí, que lee con la service role.
 */

export type MonthKey = `${number}-${string}`;

/** El mes actual en hora de Colombia, como «AAAA-MM». */
export function currentMonth(now = new Date()): MonthKey {
  const bogota = new Date(now.getTime() - 5 * 3600_000);
  return bogota.toISOString().slice(0, 7) as MonthKey;
}

/** Inicio y fin del mes en hora de Colombia (sin cambio de horario). */
export function monthRange(month: MonthKey) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { since: `${month}-01T00:00:00-05:00`, until: `${next}-01T00:00:00-05:00` };
}

/** Los últimos `count` meses hasta `month`, del más viejo al más nuevo. */
export function lastMonths(month: MonthKey, count: number): MonthKey[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return Array.from(
    { length: count },
    (_, i) =>
      new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1)).toISOString().slice(0, 7) as MonthKey,
  );
}

export type ServiceBudgets = Partial<Record<"ai" | "parallel" | "youtube" | "gemini", number>>;

export type UsageView = {
  month: MonthKey;
  workspaces: { id: string; name: string }[];
  rows: (UsageRow & { stage: UsageStage; aiUsd: number; searchUsd: number; imageUsd: number })[];
  monthly: { month: string; aiUsd: number; searchUsd: number; imageUsd: number }[];
  youtube: {
    channelId: string;
    channel: string;
    workspaceId: string | null;
    status: string;
    quotaToday: number;
    lastSyncedAt: string | null;
    lastError: string | null;
  }[];
  tasks: {
    kind: string;
    status: string;
    error: string | null;
    createdAt: string;
    workspaceId: string;
  }[];
  budgets: ServiceBudgets;
};

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function loadUsageView(
  month: MonthKey,
  workspaceId: string | null,
): Promise<UsageView> {
  const admin = createAdminClient();
  const { since, until } = monthRange(month);
  const today = new Date().toISOString().slice(0, 10);
  const [
    { data: breakdown, error },
    { data: monthly },
    { data: connections },
    { data: tasks },
    { data: budgets },
    { data: workspaces },
  ] = await Promise.all([
    admin.rpc("usage_breakdown", { since, until }),
    admin.rpc("usage_monthly", { months: 6 }),
    admin
      .from("channel_connections")
      .select(
        "channel_id, status, quota_day, quota_used, last_synced_at, last_error, channel:channels(name, workspace_id)",
      ),
    admin
      .from("tasks")
      .select("kind, status, error, created_at, workspace_id")
      .gte("created_at", since)
      .lt("created_at", until)
      .order("created_at", { ascending: false })
      .limit(5000),
    admin.from("service_budgets").select("service, monthly_usd"),
    admin.from("workspaces").select("id, name").order("name"),
  ]);
  if (error) throw error;

  const rows = (breakdown ?? [])
    .map((r) => {
      const row: UsageRow = {
        workspace_id: r.workspace_id,
        kind: r.kind,
        model: r.model,
        calls: num(r.calls),
        credits: num(r.credits),
        cost_usd: num(r.cost_usd),
        input_tokens: num(r.input_tokens),
        output_tokens: num(r.output_tokens),
        cache_tokens: num(r.cache_tokens),
        searches: num(r.searches),
        search_usd: num(r.search_usd),
        legacy_searches: num(r.legacy_searches),
        images: num(r.images),
        image_usd: num(r.image_usd),
      };
      return { ...row, stage: stageOfKind(row.kind), ...splitCost(row) };
    })
    .filter((r) => !workspaceId || r.workspace_id === workspaceId);

  return {
    month,
    workspaces: workspaces ?? [],
    rows,
    // Los últimos 6 meses, con cero en los que no hubo consumo.
    monthly: lastMonths(currentMonth(), 6).map((key) => {
      const m = (monthly ?? []).find((r) => String(r.month).slice(0, 7) === key);
      const split = splitCost({
        cost_usd: num(m?.cost_usd),
        search_usd: num(m?.search_usd),
        legacy_searches: num(m?.legacy_searches),
        image_usd: num(m?.image_usd),
      });
      return {
        month: key,
        aiUsd: split.aiUsd,
        searchUsd: split.searchUsd,
        imageUsd: split.imageUsd,
      };
    }),
    youtube: (connections ?? [])
      .filter((c) => !workspaceId || c.channel?.workspace_id === workspaceId)
      .map((c) => ({
        channelId: c.channel_id,
        channel: c.channel?.name ?? c.channel_id,
        workspaceId: c.channel?.workspace_id ?? null,
        status: c.status,
        quotaToday: c.quota_day === today ? c.quota_used : 0,
        lastSyncedAt: c.last_synced_at,
        lastError: c.last_error,
      })),
    tasks: (tasks ?? [])
      .filter((t) => !workspaceId || t.workspace_id === workspaceId)
      .map((t) => ({
        kind: t.kind,
        status: t.status,
        error: t.error,
        createdAt: t.created_at,
        workspaceId: t.workspace_id,
      })),
    budgets: Object.fromEntries(
      (budgets ?? []).map((b) => [b.service, num(b.monthly_usd)]),
    ) as ServiceBudgets,
  };
}
