"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { usd } from "@/lib/utils";

type Month = { month: string; aiUsd: number; searchUsd: number; imageUsd: number };

/**
 * Consumo de los últimos meses: barras apiladas IA + Parallel + Gemini por mes,
 * con leyenda, tooltip al pasar y la tabla con las cifras.
 */
export function UsageChart({ months }: { months: Month[] }) {
  const t = useTranslations("usage");
  const [hover, setHover] = useState<number | null>(null);
  const label = new Intl.DateTimeFormat("es-CO", { month: "short", year: "2-digit" });
  const name = (m: string) => label.format(new Date(`${m}-15T12:00:00Z`));
  const total = (m: Month) => m.aiUsd + m.searchUsd + m.imageUsd;
  const max = Math.max(0.01, ...months.map(total));
  // Del piso hacia arriba: IA, Parallel y Gemini; la de arriba lleva las esquinas redondas.
  const series = [
    { key: "aiUsd", label: t("ai"), color: "bg-[var(--series-1)]" },
    { key: "searchUsd", label: t("parallel"), color: "bg-[var(--series-2)]" },
    { key: "imageUsd", label: t("gemini"), color: "bg-[var(--series-3)]" },
  ] as const;
  const H = 140;
  const credits = (v: number) => usd(v * 100);

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        {series.map((x) => (
          <span key={x.key} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${x.color}`} aria-hidden />
            {x.label}
          </span>
        ))}
      </div>
      <div className="relative" role="img" aria-label={t("chartLabel")}>
        <div className="flex items-end gap-3 border-b border-border" style={{ height: H }}>
          {months.map((m, i) => {
            const parts = series
              .map((x) => ({ ...x, h: (m[x.key] / max) * (H - 8) }))
              .filter((x) => x.h > 0);
            return (
              <div
                key={m.month}
                className="relative flex h-full flex-1 flex-col items-center justify-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="flex w-full max-w-10 flex-col-reverse justify-start gap-[2px]">
                  {parts.map((x, j) => (
                    <div
                      key={x.key}
                      className={`${x.color} ${j === parts.length - 1 ? "rounded-t-[4px]" : ""}`}
                      style={{ height: Math.max(x.h, 2) }}
                    />
                  ))}
                </div>
                {hover === i ? (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm">
                    <p className="font-medium">{name(m.month)}</p>
                    {series.map((x) => (
                      <p key={x.key}>
                        {x.label}: {credits(m[x.key])}
                      </p>
                    ))}
                    <p className="text-muted">
                      {t("total")}: {credits(total(m))}
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
              {series.map((x) => (
                <th key={x.key} className="py-1 font-normal">
                  {x.label}
                </th>
              ))}
              <th className="py-1 font-normal">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-border">
                <td className="py-1">{name(m.month)}</td>
                {series.map((x) => (
                  <td key={x.key} className="py-1 tabular-nums">
                    {credits(m[x.key])}
                  </td>
                ))}
                <td className="py-1 tabular-nums">{credits(total(m))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
