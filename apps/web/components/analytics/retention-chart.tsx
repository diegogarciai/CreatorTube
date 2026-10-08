"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { retentionAt, type ParagraphRetention, type RetentionPoint } from "@planificador/core";
import { cn } from "@/lib/utils";
import { clockLabel } from "./stat-tiles";

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

const pct = (v: number) => `${Math.round(v * 100)} %`;
const excerpt = (text: string, words = 12) => {
  const w = text
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return w.slice(0, words).join(" ") + (w.length > words ? "…" : "");
};

/**
 * Curva de retención del video con los tramos de cada párrafo del guion. Los
 * párrafos con las 3 caídas mayores van sombreados; al pasar el puntero se ve
 * la retención en ese punto y el párrafo que sonaba.
 */
export function RetentionChart({
  points,
  paragraphs,
  durationS,
}: {
  points: RetentionPoint[];
  paragraphs: ParagraphRetention[];
  durationS: number | null;
}) {
  const t = useTranslations("metrics");
  const [hover, setHover] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.r - b.r);
  const top = Math.max(1, Math.ceil(Math.max(...sorted.map((p) => p.watch)) * 10) / 10);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (r: number) => PAD.left + r * iw;
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  const line = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.r)},${y(p.watch)}`).join(" ");
  const area = `${line} L${x(sorted.at(-1)!.r)},${y(0)} L${x(sorted[0]!.r)},${y(0)} Z`;
  const ticks = Array.from({ length: Math.round(top / 0.25) + 1 }, (_, i) => i * 0.25);
  const paragraphAt = (r: number) => paragraphs.find((p) => r >= p.from && r <= p.to) ?? null;
  const hp = hover === null ? null : paragraphAt(hover);
  const shown = active ?? hp?.index ?? null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const r = (((e.clientX - box.left) / box.width) * W - PAD.left) / iw;
    setHover(Math.min(Math.max(r, 0), 1));
  };

  return (
    <div className="space-y-3">
      <figure className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label={t("retentionAria")}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {paragraphs.map((p) => (
            <rect
              key={p.index}
              x={x(p.from)}
              y={PAD.top}
              width={Math.max(x(p.to) - x(p.from), 0)}
              height={ih}
              className={cn(p.top ? "fill-warn" : "fill-muted", shown === p.index && "fill-accent")}
              opacity={shown === p.index ? 0.14 : p.top ? 0.12 : p.index % 2 ? 0.05 : 0}
            />
          ))}
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted text-[10px] tabular-nums"
              >
                {pct(v)}
              </text>
            </g>
          ))}
          {[0, 0.5, 1].map((r) => (
            <text
              key={r}
              x={x(r)}
              y={H - 6}
              textAnchor={r === 0 ? "start" : r === 1 ? "end" : "middle"}
              className="fill-muted text-[10px] tabular-nums"
            >
              {durationS ? clockLabel(durationS * r) : pct(r)}
            </text>
          ))}
          <path d={area} className="fill-accent" opacity={0.1} />
          <path
            d={line}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hover !== null ? (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + ih}
                className="stroke-muted"
                strokeWidth={1}
              />
              <circle
                cx={x(hover)}
                cy={y(retentionAt(sorted, hover))}
                r={4.5}
                className="fill-accent stroke-surface"
                strokeWidth={2}
              />
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 max-w-64 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: `translateX(${hover > 0.5 ? "-105%" : "5%"})`,
            }}
          >
            <div className="font-medium tabular-nums">
              {t("stillWatching", { pct: pct(retentionAt(sorted, hover)) })}
              {durationS ? (
                <span className="text-muted"> · {clockLabel(durationS * hover)}</span>
              ) : null}
            </div>
            {hp ? (
              <div className="text-muted">
                {t("paragraphN", { n: hp.index + 1 })}: {excerpt(hp.text, 10)}
              </div>
            ) : null}
          </div>
        ) : null}
      </figure>

      {paragraphs.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">
            {t("allParagraphs", { count: paragraphs.length })}
          </summary>
          <ol className="mt-2 space-y-1">
            {paragraphs.map((p) => (
              <li key={p.index}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(p.index)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(p.index)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    "flex w-full gap-3 rounded-md px-2 py-1 text-left hover:bg-surface-muted",
                    p.top && "bg-warn-soft",
                  )}
                >
                  <span className="w-6 shrink-0 text-xs text-muted tabular-nums">
                    {p.index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-xs">{excerpt(p.text, 18)}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {pct(p.start)} → {pct(p.end)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

/** «Dónde se fue la gente»: los 3 párrafos con mayor caída. */
export function TopDrops({
  paragraphs,
  durationS,
}: {
  paragraphs: ParagraphRetention[];
  durationS: number | null;
}) {
  const t = useTranslations("metrics");
  const top = paragraphs.filter((p) => p.top).sort((a, b) => b.drop - a.drop);
  if (!top.length) return null;
  return (
    <ol className="space-y-2" data-testid="top-drops">
      {top.map((p) => (
        <li
          key={p.index}
          className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">
              {t("paragraphN", { n: p.index + 1 })}
              {durationS ? (
                <span className="font-normal text-muted"> · {clockLabel(durationS * p.from)}</span>
              ) : null}
            </span>
            <span className="text-xs tabular-nums">
              {t("drop", { points: Math.round(p.drop * 100), from: pct(p.start), to: pct(p.end) })}
            </span>
          </div>
          <p className="mt-1 text-muted">{excerpt(p.text, 40)}</p>
        </li>
      ))}
    </ol>
  );
}
