import { describe, expect, it } from "vitest";
import {
  compare,
  daySummary,
  lastCompleteDay,
  median,
  typicalDay,
  yesterdayFromSnapshots,
  type ChannelDay,
  type Snapshot,
} from "./daily-report";

const snap = (videoId: string, day: string, views: number, likes = 0, comments = 0): Snapshot => ({
  videoId,
  day,
  views,
  likes,
  comments,
  takenAt: `${day}T11:05:00Z`,
});

const channelDay = (day: string, views: number): ChannelDay => ({
  day,
  views,
  watchMinutes: views * 4,
  averageViewDurationS: 240,
  subscribersNet: 2,
  likes: Math.round(views / 20),
  comments: Math.round(views / 100),
});

const days = (n: number, views: (i: number) => number) =>
  Array.from({ length: n }, (_, i) =>
    channelDay(`2026-09-${String(i + 1).padStart(2, "0")}`, views(i)),
  );

describe("así te fue ayer", () => {
  it("resta las dos fotos más recientes, sin negativos, y cuenta los videos nuevos enteros", () => {
    const y = yesterdayFromSnapshots([
      snap("a", "2026-10-06", 900, 40, 5),
      snap("a", "2026-10-07", 1000, 45, 6),
      snap("a", "2026-10-08", 1300, 60, 9),
      snap("b", "2026-10-07", 500, 10, 1),
      snap("b", "2026-10-08", 480, 12, 1),
      snap("nuevo", "2026-10-08", 250, 20, 4),
    ]);
    expect(y).toMatchObject({
      fromDay: "2026-10-07",
      toDay: "2026-10-08",
      views: 300 + 0 + 250,
      likes: 15 + 2 + 20,
      comments: 3 + 0 + 4,
      from: "2026-10-07T11:05:00Z",
      to: "2026-10-08T11:05:00Z",
    });
    expect(y!.top).toMatchObject({ videoId: "a", views: 300 });
    expect(y!.top!.share).toBeCloseTo(300 / 550);
  });

  it("sin dos días de fotos, nada; sin vistas, sin video destacado", () => {
    expect(yesterdayFromSnapshots([snap("a", "2026-10-08", 10)])).toBeNull();
    expect(yesterdayFromSnapshots([])).toBeNull();
    const y = yesterdayFromSnapshots([snap("a", "2026-10-07", 10), snap("a", "2026-10-08", 10)]);
    expect(y).toMatchObject({ views: 0, top: null });
  });

  it("el día típico es la mediana de los últimos 28 días (con al menos 7)", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
    // 30 días: solo cuentan los últimos 28 (los dos primeros, enormes, no).
    const t = typicalDay(days(30, (i) => (i < 2 ? 100_000 : 100 + i)));
    expect(t!.views).toBe(median(Array.from({ length: 28 }, (_, i) => 102 + i)));
    expect(typicalDay(days(6, () => 100))).toBeNull();
    expect(lastCompleteDay(days(3, (i) => i))?.day).toBe("2026-09-03");
  });

  it("compara contra lo normal y arma la frase", () => {
    expect(compare(130, 100)).toBeCloseTo(0.3);
    expect(compare(10, 0)).toBeNull();
    expect(compare(10, null)).toBeNull();
    const typical = typicalDay(days(28, () => 400))!;
    const report = (views: number, top: number) =>
      yesterdayFromSnapshots([
        snap("a", "2026-10-07", 0),
        snap("a", "2026-10-08", top),
        snap("b", "2026-10-07", 0),
        snap("b", "2026-10-08", views - top),
      ])!;
    expect(daySummary(report(520, 300), typical)).toEqual({
      tone: "good",
      change: 0.3,
      driver: { videoId: "a", views: 300 },
    });
    expect(daySummary(report(400, 100), typical)).toMatchObject({
      tone: "normal",
      driver: { videoId: "b", views: 300 },
    });
    // Repartido entre varios videos (ninguno llega al 40 %): sin «impulsado por».
    const spread = yesterdayFromSnapshots(
      ["a", "b", "c"].flatMap((v) => [snap(v, "2026-10-07", 0), snap(v, "2026-10-08", 130)]),
    )!;
    expect(daySummary(spread, typical)).toMatchObject({ tone: "normal", driver: null });
    expect(daySummary(report(200, 100), typical)).toMatchObject({ tone: "weak", change: -0.5 });
    expect(daySummary(report(200, 100), null)).toMatchObject({ tone: null, change: null });
  });
});
