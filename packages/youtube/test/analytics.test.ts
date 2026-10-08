import { describe, expect, it, vi } from "vitest";
import {
  syncAnalytics,
  YouTubeAnalyticsClient,
  type AnalyticsStore,
  type DailyMetrics,
  type RetentionPoint,
} from "../src";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const dailyBody = (days: string[]) => ({
  columnHeaders: [
    { name: "day" },
    { name: "views" },
    { name: "estimatedMinutesWatched" },
    { name: "averageViewDuration" },
    { name: "averageViewPercentage" },
    { name: "subscribersGained" },
    { name: "subscribersLost" },
    { name: "likes" },
    { name: "comments" },
    { name: "shares" },
  ],
  rows: days.map((d, i) => [d, 100 + i, 50, 240, 41.5, 3, 1, 9, 2, 1]),
});

const retentionBody = {
  columnHeaders: [
    { name: "elapsedVideoTimeRatio" },
    { name: "audienceWatchRatio" },
    { name: "relativeRetentionPerformance" },
  ],
  rows: [
    [0.01, 1.0, 0.6],
    [0.5, 0.45, 0.52],
    [1, 0.2, 0.4],
  ],
};

describe("cliente de la Analytics API", () => {
  it("pide reports.query del canal y lee las filas por columna", async () => {
    const fetchImpl = vi.fn(async (_u: string) => json(dailyBody(["2026-10-01", "2026-10-02"])));
    const client = new YouTubeAnalyticsClient("tok", fetchImpl as unknown as typeof fetch);
    const days = await client.videoDaily("abc", "2026-10-01", "2026-10-02");
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://youtubeanalytics.googleapis.com/v2/reports");
    expect(url.searchParams.get("ids")).toBe("channel==MINE");
    expect(url.searchParams.get("dimensions")).toBe("day");
    expect(url.searchParams.get("filters")).toBe("video==abc");
    expect(url.searchParams.get("metrics")).toContain("averageViewPercentage");
    expect(days[1]).toEqual<DailyMetrics>({
      day: "2026-10-02",
      views: 101,
      watchMinutes: 50,
      averageViewDurationS: 240,
      averageViewPercentage: 41.5,
      subscribersGained: 3,
      subscribersLost: 1,
      likes: 9,
      comments: 2,
      shares: 1,
    });
    expect(client.requests).toBe(1);
  });

  it("retención: 100 puntos por parte del video; sin filas, vacía", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(retentionBody))
      .mockResolvedValueOnce(json({ columnHeaders: retentionBody.columnHeaders }));
    const client = new YouTubeAnalyticsClient("tok", fetchImpl as unknown as typeof fetch);
    expect(await client.videoRetention("v", "2026-10-01", "2026-10-08")).toEqual<RetentionPoint[]>([
      { r: 0.01, watch: 1, relative: 0.6 },
      { r: 0.5, watch: 0.45, relative: 0.52 },
      { r: 1, watch: 0.2, relative: 0.4 },
    ]);
    expect(await client.videoRetention("v", "2026-10-01", "2026-10-08")).toEqual([]);
  });

  it("los errores traen el estado y el motivo", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { message: "No autorizado", errors: [{ reason: "authError" }] } }, 401),
    );
    const client = new YouTubeAnalyticsClient("tok", fetchImpl as unknown as typeof fetch);
    await expect(client.channelDaily("2026-10-01", "2026-10-02")).rejects.toMatchObject({
      status: 401,
      reason: "authError",
      unauthorized: true,
    });
  });
});

function memoryStore(last: string | null, videos: { id: string; publishedAt: Date }[]) {
  const saved = { channel: 0, videoDays: [] as string[], retention: [] as string[], reauth: "" };
  const store: AnalyticsStore = {
    saveTokens: vi.fn(async () => {}),
    markNeedsReauth: vi.fn(async (_c, e) => void (saved.reauth = e)),
    lastChannelDay: async () => last,
    saveChannelDays: async (_c, days) => void (saved.channel = days.length),
    publishedVideos: async () => videos,
    saveVideoDays: async (_c, id) => void saved.videoDays.push(id),
    saveRetention: async (_c, id) => void saved.retention.push(id),
  };
  return { store, saved };
}

describe("sincronización de la analítica", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const conn = {
    channelId: "ch",
    timezone: "UTC",
    accessToken: "tok",
    refreshToken: "ref",
    tokenExpiresAt: new Date("2026-10-08T13:00:00Z"),
  };

  it("90 días la primera vez; retención solo de 2 a 60 días", async () => {
    const urls: URL[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      return url.searchParams.get("dimensions") === "elapsedVideoTimeRatio"
        ? json(retentionBody)
        : json(dailyBody(["2026-10-07"]));
    });
    const { store, saved } = memoryStore(null, [
      { id: "nuevo", publishedAt: new Date("2026-10-07T12:00:00Z") },
      { id: "semana", publishedAt: new Date("2026-10-01T12:00:00Z") },
    ]);
    const res = await syncAnalytics(conn, {
      oauth: { clientId: "c", clientSecret: "s" },
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    expect(res).toMatchObject({ ok: true, videos: 2, retention: 1, requests: 4 });
    expect(urls[0]!.searchParams.get("startDate")).toBe("2026-07-10");
    expect(saved.videoDays).toEqual(["nuevo", "semana"]);
    expect(saved.retention).toEqual(["semana"]);
  });

  it("después, solo los últimos 7 días del canal", async () => {
    const fetchImpl = vi.fn(async (_u: string) => json(dailyBody([])));
    const { store } = memoryStore("2026-10-06", []);
    await syncAnalytics(conn, {
      oauth: { clientId: "c", clientSecret: "s" },
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.searchParams.get("startDate")).toBe("2026-10-01");
  });

  it("un 401 marca la conexión para volver a autorizar", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { message: "Token vencido" } }, 401));
    const { store, saved } = memoryStore(null, []);
    const res = await syncAnalytics(conn, {
      oauth: { clientId: "c", clientSecret: "s" },
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    expect(res).toMatchObject({ ok: false, needsReauth: true });
    expect(saved.reauth).toBe("Token vencido");
  });
});
