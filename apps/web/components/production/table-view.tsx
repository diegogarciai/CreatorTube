"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { statusIndex, stageIndex } from "@planificador/core";
import { StatusBadge } from "@/components/episodes/status-badge";
import { formatDateKey } from "@/lib/utils";
import type { ProductionEpisode } from "./types";

export function TableView({ episodes, channelId }: { episodes: ProductionEpisode[]; channelId: string }) {
  const t = useTranslations();
  const [sorting, setSorting] = useState<SortingState>([{ id: "publishDate", desc: false }]);
  const columns = useMemo<ColumnDef<ProductionEpisode>[]>(
    () => [
      { accessorKey: "number", header: t("production.columns.number"), size: 60 },
      {
        accessorKey: "title",
        header: t("production.columns.title"),
        cell: (c) => (
          <Link href={`/c/${channelId}/episodios/${c.row.original.id}`} className="font-medium hover:underline">
            {c.row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: t("production.columns.status"),
        sortingFn: (a, b) => statusIndex(a.original.status) - statusIndex(b.original.status),
        cell: (c) => <StatusBadge status={c.row.original.status} />,
      },
      {
        accessorKey: "stage",
        header: t("production.columns.stage"),
        sortingFn: (a, b) => stageIndex(a.original.stage) - stageIndex(b.original.stage),
        cell: (c) => t(`stage.${c.row.original.stage}`),
      },
      {
        accessorKey: "publishDate",
        header: t("production.columns.publishDate"),
        sortUndefined: "last",
        cell: (c) => formatDateKey(c.row.original.publishDate),
      },
      {
        accessorKey: "recordDate",
        header: t("production.columns.recordDate"),
        sortUndefined: "last",
        cell: (c) => formatDateKey(c.row.original.recordDate),
      },
      { accessorKey: "format", header: t("production.columns.format"), cell: (c) => t(`format.${c.row.original.format}`) },
      {
        id: "pillar",
        accessorFn: (e) => e.pillar?.name ?? "",
        header: t("production.columns.pillar"),
      },
      {
        id: "checklist",
        accessorFn: (e) => (e.checklist.total ? e.checklist.done / e.checklist.total : 0),
        header: t("production.columns.checklist"),
        cell: (c) => `${c.row.original.checklist.done}/${c.row.original.checklist.total}`,
      },
    ],
    [t, channelId],
  );

  const data = useMemo(
    () => episodes.map((e) => ({ ...e, publishDate: e.publishDate ?? undefined, recordDate: e.recordDate ?? undefined })) as ProductionEpisode[],
    [episodes],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table no es memoizable; el componente es pequeño.
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[800px] text-sm">
        <thead className="border-b border-border bg-surface-muted/60 text-left">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="px-3 py-2 font-medium">
                  <button className="flex items-center gap-1" onClick={h.column.getToggleSortingHandler()}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === "asc" ? <ArrowUp className="size-3" /> : null}
                    {h.column.getIsSorted() === "desc" ? <ArrowDown className="size-3" /> : null}
                  </button>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-muted/50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
