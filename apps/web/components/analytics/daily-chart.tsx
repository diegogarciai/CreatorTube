"use client";

import { useState } from "react";
import type { DayPoint } from "@/lib/data/analytics";

const W = 640;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

/** Ticks redondos del eje Y (0, 500, 1.000…). */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

const fmtNum = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });
const fmtDay = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const day = (d: string) => fmtDay.format(new Date(`${d}T00:00:00Z`));

/**
 * Una serie por día (vistas): línea de 2 px con un lavado del 10 %, retícula
 * de 1 px y cruz con el valor al pasar el puntero o tocar.
 */
export function DailyChart({
  points,
  label,
  format = (v) => new Intl.NumberFormat("es-CO").format(Math.round(v)),
}: {
  points: DayPoint[];
  /** Qué se grafica (para el lector de pantalla y el tooltip). */
  label: string;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * iw;
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const h = hover === null ? null : points[hover]!;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / iw) * (points.length - 1));
    setHover(Math.min(Math.max(i, 0), points.length - 1));
  };

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`${label}: ${points.length} días`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted text-[10px] tabular-nums"
            >
              {fmtNum.format(t)}
            </text>
          </g>
        ))}
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            className="fill-muted text-[10px]"
          >
            {day(points[i]!.day)}
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
        {h && hover !== null ? (
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
              cy={y(h.value)}
              r={4.5}
              className="fill-accent stroke-surface"
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>
      {h && hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})`,
          }}
        >
          <div className="text-muted">{day(h.day)}</div>
          <div className="font-medium tabular-nums">
            {format(h.value)} {label.toLowerCase()}
          </div>
        </div>
      ) : null}
    </figure>
  );
}
