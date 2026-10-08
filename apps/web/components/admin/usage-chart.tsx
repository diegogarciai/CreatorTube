"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { usd } from "@/lib/utils";

type Month = { month: string; aiUsd: number; searchUsd: number };

/**
 * Consumo de los últimos meses: barras apiladas IA + Parallel por mes, con
 * leyenda, tooltip al pasar y la tabla con las cifras.
 */
export function UsageChart({ months }: { months: Month[] }) {
  const t = useTranslations("usage");
  const [hover, setHover] = useState<number | null>(null);
  const label = new Intl.DateTimeFormat("es-CO", { month: "short", year: "2-digit" });
  const name = (m: string) => label.format(new Date(`${m}-15T12:00:00Z`));
  const max = Math.max(0.01, ...months.map((m) => m.aiUsd + m.searchUsd));
  const H = 140;
  const credits = (v: number) => usd(v * 100);

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--series-1)]" aria-hidden />
          {t("ai")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--series-2)]" aria-hidden />
          {t("parallel")}
        </span>
      </div>
      <div className="relative" role="img" aria-label={t("chartLabel")}>
        <div className="flex items-end gap-3 border-b border-border" style={{ height: H }}>
          {months.map((m, i) => {
            const ai = (m.aiUsd / max) * (H - 8);
            const search = (m.searchUsd / max) * (H - 8);
            return (
              <div
                key={m.month}
                className="relative flex h-full flex-1 flex-col items-center justify-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="flex w-full max-w-10 flex-col justify-end gap-[2px]">
                  {search > 0 ? (
                    <div
                      className="rounded-t-[4px] bg-[var(--series-2)]"
                      style={{ height: Math.max(search, 2) }}
                    />
                  ) : null}
                  {ai > 0 ? (
                    <div
                      className={`bg-[var(--series-1)] ${search > 0 ? "" : "rounded-t-[4px]"}`}
                      style={{ height: Math.max(ai, 2) }}
                    />
                  ) : null}
                </div>
                {hover === i ? (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm">
                    <p className="font-medium">{name(m.month)}</p>
                    <p>
                      {t("ai")}: {credits(m.aiUsd)}
                    </p>
                    <p>
                      {t("parallel")}: {credits(m.searchUsd)}
                    </p>
                    <p className="text-muted">
                      {t("total")}: {credits(m.aiUsd + m.searchUsd)}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-3 text-xs text-muted">
          {months.map((m) => (
            <span key={m.month} className="flex-1 text-center">
              {name(m.month)}
            </span>
          ))}
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">{t("table")}</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-normal">{t("month")}</th>
              <th className="py-1 font-normal">{t("ai")}</th>
              <th className="py-1 font-normal">{t("parallel")}</th>
              <th className="py-1 font-normal">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-border">
                <td className="py-1">{name(m.month)}</td>
                <td className="py-1 tabular-nums">{credits(m.aiUsd)}</td>
                <td className="py-1 tabular-nums">{credits(m.searchUsd)}</td>
                <td className="py-1 tabular-nums">{credits(m.aiUsd + m.searchUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
