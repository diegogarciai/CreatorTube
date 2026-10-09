import { describe, expect, it, vi } from "vitest";
import {
  parseReachCsv,
  REACH_REPORTS,
  sumBySource,
  syncReach,
  trafficSourceLabel,
  type ReachRow,
  type ReachStore,
  type ReportingState,
} from "../src";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (body: string) => new Response(body, { status: 200 });

const now = new Date("2026-10-09T12:00:00Z");
const conn = {
  channelId: "ch1",
  timezone: "America/Bogota",
  accessToken: "tok",
  refreshToken: "ref",
  tokenExpiresAt: new Date("2026-10-09T13:00:00Z"),
};
const oauth = { clientId: "id", clientSecret: "secret" };

const BASIC_CSV = [
  "date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr",
  "20261005,UC1,vidA,1000,0.054",
  "20261005,UC1,vidB,200,6.5",
].join("\n");
const COMBINED_CSV = [
  "date,channel_id,video_id,traffic_source_type,device_type,video_thumbnail_impressions,video_thumbnail_impressions_ctr",
  "20261005,UC1,vidA,5,1,600,0.05",
  "20261005,UC1,vidA,5,2,200,0.1",
  "20261005,UC1,vidA,3,1,200,0.03",
].join("\n");

function memoryStore(initial: ReportingState = {}) {
  const store = {
    state: initial,
    reach: [] as ReachRow[],
    sources: [] as ReturnType<typeof sumBySource>,
    reauth: null as string | null,
    async saveTokens() {},
    async markNeedsReauth(_c: string, msg: string) {
      store.reauth = msg;
    },
    async reportingState() {
      return store.state;
    },
    async saveReportingState(_c: string, s: ReportingState) {
      store.state = JSON.parse(JSON.stringify(s));
    },
    async saveReach(_c: string, rows: ReachRow[]) {
      store.reach.push(...rows);
    },
    async saveReachSources(_c: string, rows: ReturnType<typeof sumBySource>) {
      store.sources.push(...rows);
    },
  };
  return store satisfies ReachStore;
}

/** Un YouTube Reporting falso: trabajos, reportes por trabajo y descargas. */
function fakeReporting(opts: { jobs?: { id: string; reportTypeId: string }[]; status?: number }) {
  const jobs = [...(opts.jobs ?? [])];
  const reports: Record<
    string,
    { id: string; startTime: string; createTime: string; downloadUrl: string }[]
  > = {
    "job-basic": [
      {
        id: "r2",
        startTime: "2026-10-06T07:00:00Z",
        createTime: "2026-10-08T10:00:00Z",
        downloadUrl: "https://youtubereporting.googleapis.com/v1/media/b2",
      },
      {
        id: "r1",
        startTime: "2026-10-05T07:00:00Z",
        createTime: "2026-10-07T10:00:00Z",
        downloadUrl: "https://youtubereporting.googleapis.com/v1/media/b1",
      },
    ],
    "job-combined": [
      {
        id: "c1",
        startTime: "2026-10-05T07:00:00Z",
        createTime: "2026-10-07T11:00:00Z",
        downloadUrl: "https://youtubereporting.googleapis.com/v1/media/c1",
      },
    ],
  };
  const fetchImpl = vi.fn(async (u: string, init?: RequestInit) => {
    if (opts.status)
      return json({ error: { message: "no", status: "UNAUTHENTICATED" } }, opts.status);
    const url = new URL(u);
    if (url.pathname === "/v1/jobs" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const job = {
        id: body.reportTypeId === REACH_REPORTS.basic ? "job-basic" : "job-combined",
        reportTypeId: body.reportTypeId,
      };
      jobs.push(job);
      return json(job);
    }
    if (url.pathname === "/v1/jobs") return json({ jobs });
    const m = /^\/v1\/jobs\/([^/]+)\/reports$/.exec(url.pathname);
    if (m) {
      const after = url.searchParams.get("createdAfter");
      return json({
        reports: (reports[m[1]!] ?? []).filter((r) => !after || r.createTime > after),
      });
    }
    if (url.pathname.startsWith("/v1/media/b")) return text(BASIC_CSV);
    if (url.pathname.startsWith("/v1/media/c")) return text(COMBINED_CSV);
    return json({}, 404);
  });
  return fetchImpl;
}

describe("reportes de alcance", () => {
  it("lee el CSV por encabezado, pasa la fecha a ISO y deja el CTR de 0 a 1", () => {
    const rows = parseReachCsv(BASIC_CSV);
    expect(rows).toEqual([
      { videoId: "vidA", day: "2026-10-05", impressions: 1000, ctr: 0.054, trafficSource: null },
      { videoId: "vidB", day: "2026-10-05", impressions: 200, ctr: 0.065, trafficSource: null },
    ]);
    expect(parseReachCsv("")).toEqual([]);
    expect(parseReachCsv("a,b\n1,2")).toEqual([]);
  });

  it("suma los dispositivos por fuente (clics = impresiones × CTR)", () => {
    const rows = sumBySource(parseReachCsv(COMBINED_CSV));
    expect(rows).toEqual([
      { videoId: "vidA", day: "2026-10-05", trafficSource: "5", impressions: 800, clicks: 50 },
      { videoId: "vidA", day: "2026-10-05", trafficSource: "3", impressions: 200, clicks: 6 },
    ]);
    expect(trafficSourceLabel("5")).toBe("Búsqueda de YouTube");
    expect(trafficSourceLabel("99")).toBe("Otra fuente (99)");
  });

  it("la primera vez crea los trabajos y baja los reportes del más viejo al más nuevo", async () => {
    const fetchImpl = fakeReporting({});
    const store = memoryStore();
    const out = await syncReach(conn, {
      oauth,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    expect(out).toMatchObject({ ok: true, jobsCreated: 2, reports: 3, rows: 2 + 2 + 3 });
    const downloads = fetchImpl.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("/media/"));
    expect(downloads).toEqual([
      "https://youtubereporting.googleapis.com/v1/media/b1",
      "https://youtubereporting.googleapis.com/v1/media/b2",
      "https://youtubereporting.googleapis.com/v1/media/c1",
    ]);
    expect(store.state).toEqual({
      [REACH_REPORTS.basic]: { jobId: "job-basic", after: "2026-10-08T10:00:00Z" },
      [REACH_REPORTS.combined]: { jobId: "job-combined", after: "2026-10-07T11:00:00Z" },
    });
    expect(store.sources).toHaveLength(2);
    const auth = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(auth.authorization).toBe("Bearer tok");
  });

  it("reusa un trabajo que ya existe y pide solo los reportes nuevos", async () => {
    const fetchImpl = fakeReporting({
      jobs: [
        { id: "job-basic", reportTypeId: REACH_REPORTS.basic },
        { id: "job-combined", reportTypeId: REACH_REPORTS.combined },
      ],
    });
    const store = memoryStore({
      [REACH_REPORTS.basic]: { jobId: "job-basic", after: "2026-10-07T10:00:00Z" },
    });
    const out = await syncReach(conn, {
      oauth,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    expect(out).toMatchObject({ ok: true, jobsCreated: 0, reports: 2 });
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("createdAfter=2026-10-07T10%3A00%3A00Z"))).toBe(true);
    expect(urls.filter((u) => u.endsWith("/v1/jobs?"))).toHaveLength(1);
  });

  it("un 401 pide reconectar el canal", async () => {
    const store = memoryStore();
    const out = await syncReach(conn, {
      oauth,
      store,
      fetchImpl: fakeReporting({ status: 401 }) as unknown as typeof fetch,
      now,
    });
    expect(out).toMatchObject({ ok: false, needsReauth: true });
    expect(store.reauth).toBe("no");
  });
});
