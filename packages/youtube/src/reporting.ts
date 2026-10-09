import { YouTubeApiError } from "./api";
import { OAuthError, type GoogleOAuthConfig } from "./oauth";
import { freshAccessToken, type StoredConnection, type SyncStore } from "./sync";

/**
 * Alcance de los videos (Fase 4 · paso 2): impresiones de la miniatura y su
 * CTR, por video y por día, y de qué fuente de tráfico salieron. No están en
 * la Analytics API: salen de la YouTube Reporting API, que no gasta cuota de
 * la Data API y usa el mismo permiso `yt-analytics.readonly`.
 *
 * Por canal hay un trabajo por tipo de reporte. YouTube genera un CSV por día
 * (con hasta 48 h de atraso) y lo guarda unos 60 días; aquí se descargan los
 * nuevos desde el último visto y se archivan en la base.
 */
const API = "https://youtubereporting.googleapis.com/v1";

export const REACH_REPORTS = {
  /** Impresiones y CTR por video y por día. */
  basic: "channel_reach_basic_a1",
  /** Lo mismo, además por fuente de tráfico y dispositivo. */
  combined: "channel_reach_combined_a1",
} as const;
export type ReachReportType = (typeof REACH_REPORTS)[keyof typeof REACH_REPORTS];

/** Las fuentes de tráfico de YouTube (`traffic_source_type`), en español. */
export const TRAFFIC_SOURCES: Record<string, string> = {
  "0": "Directo o desconocido",
  "1": "Publicidad de YouTube",
  "3": "Inicio y exploración",
  "4": "Páginas de canal",
  "5": "Búsqueda de YouTube",
  "7": "Videos sugeridos",
  "8": "Otras funciones de YouTube",
  "9": "Externo",
  "11": "Tarjetas del video",
  "14": "Listas de reproducción",
  "17": "Notificaciones",
  "18": "Páginas de listas",
  "20": "Pantallas finales",
  "23": "Historias",
  "24": "Shorts",
};
export const trafficSourceLabel = (code: string) =>
  TRAFFIC_SOURCES[code] ?? `Otra fuente (${code})`;

export interface ReportingJob {
  id: string;
  reportTypeId: string;
}

export interface ReportFile {
  id: string;
  /** Día que cubre (AAAA-MM-DD). */
  startTime: string;
  createTime: string;
  downloadUrl: string;
}

/** Una fila de alcance: un video en un día (y una fuente, en el combinado). */
export interface ReachRow {
  videoId: string;
  day: string;
  impressions: number;
  /** De 0 a 1. */
  ctr: number;
  trafficSource: string | null;
}

type Json = Record<string, any>;

export class YouTubeReportingClient {
  requests = 0;

  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    this.requests++;
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${this.accessToken}`, ...init.headers },
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as Json;
      const reason = json.error?.errors?.[0]?.reason ?? json.error?.status ?? null;
      throw new YouTubeApiError(
        json.error?.message ?? `YouTube Reporting respondió ${res.status}`,
        res.status,
        reason,
      );
    }
    return res;
  }

  async listJobs(): Promise<ReportingJob[]> {
    const jobs: ReportingJob[] = [];
    let page: string | undefined;
    do {
      const q = new URLSearchParams(page ? { pageToken: page } : {});
      const json = (await (await this.call(`${API}/jobs?${q}`)).json()) as Json;
      for (const j of json.jobs ?? []) jobs.push({ id: j.id, reportTypeId: j.reportTypeId });
      page = json.nextPageToken || undefined;
    } while (page);
    return jobs;
  }

  async createJob(reportTypeId: string, name: string): Promise<ReportingJob> {
    const res = await this.call(`${API}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportTypeId, name }),
    });
    const j = (await res.json()) as Json;
    return { id: j.id, reportTypeId: j.reportTypeId ?? reportTypeId };
  }

  /** Los reportes del trabajo creados después de `createdAfter` (ISO). */
  async listReports(jobId: string, createdAfter?: string | null): Promise<ReportFile[]> {
    const out: ReportFile[] = [];
    let page: string | undefined;
    do {
      const q = new URLSearchParams({
        ...(createdAfter ? { createdAfter } : {}),
        ...(page ? { pageToken: page } : {}),
      });
      const json = (await (
        await this.call(`${API}/jobs/${encodeURIComponent(jobId)}/reports?${q}`)
      ).json()) as Json;
      for (const r of json.reports ?? [])
        out.push({
          id: r.id,
          startTime: String(r.startTime ?? "").slice(0, 10),
          createTime: r.createTime,
          downloadUrl: r.downloadUrl,
        });
      page = json.nextPageToken || undefined;
    } while (page);
    return out;
  }

  async download(url: string): Promise<string> {
    return (await this.call(url)).text();
  }
}

/** Separa una línea CSV respetando comillas. */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Lee un reporte de alcance (CSV con encabezado). Las columnas se buscan por
 * nombre; la fecha pasa de AAAAMMDD a AAAA-MM-DD y el CTR queda de 0 a 1 (si
 * llega en porcentaje, se divide entre 100).
 */
export function parseReachCsv(text: string): ReachRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = csvLine(lines[0]!).map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const [iDate, iVideo, iImp, iCtr, iSource] = [
    col("date"),
    col("video_id"),
    col("video_thumbnail_impressions"),
    col("video_thumbnail_impressions_ctr"),
    col("traffic_source_type"),
  ];
  if (iDate < 0 || iVideo < 0 || iImp < 0 || iCtr < 0) return [];
  return lines.slice(1).flatMap((line): ReachRow[] => {
    const v = csvLine(line);
    const d = (v[iDate] ?? "").trim();
    const videoId = (v[iVideo] ?? "").trim();
    const impressions = Number(v[iImp]) || 0;
    let ctr = Number(v[iCtr]) || 0;
    if (ctr > 1) ctr /= 100;
    if (!/^\d{8}$/.test(d) || !videoId) return [];
    return [
      {
        videoId,
        day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        impressions,
        ctr: Math.min(Math.max(ctr, 0), 1),
        trafficSource: iSource >= 0 ? (v[iSource] ?? "").trim() || "0" : null,
      },
    ];
  });
}

/** Una fila por video, día y fuente: suma los dispositivos (clics = impresiones × CTR). */
export function sumBySource(
  rows: readonly ReachRow[],
): { videoId: string; day: string; trafficSource: string; impressions: number; clicks: number }[] {
  const acc = new Map<
    string,
    { videoId: string; day: string; trafficSource: string; impressions: number; clicks: number }
  >();
  for (const r of rows) {
    const source = r.trafficSource ?? "0";
    const key = `${r.videoId}|${r.day}|${source}`;
    const cur = acc.get(key) ?? {
      videoId: r.videoId,
      day: r.day,
      trafficSource: source,
      impressions: 0,
      clicks: 0,
    };
    cur.impressions += r.impressions;
    cur.clicks += r.impressions * r.ctr;
    acc.set(key, cur);
  }
  return [...acc.values()];
}

/** Por tipo de reporte: el trabajo y la fecha del último reporte leído. */
export type ReportingState = Partial<
  Record<ReachReportType, { jobId: string; after: string | null }>
>;

export interface ReachStore extends Pick<SyncStore, "saveTokens" | "markNeedsReauth"> {
  reportingState(channelId: string): Promise<ReportingState>;
  saveReportingState(channelId: string, state: ReportingState): Promise<void>;
  /** Del reporte básico: reemplaza los días que trae. */
  saveReach(channelId: string, rows: ReachRow[], fetchedAt: Date): Promise<void>;
  /** Del combinado: reemplaza los días que trae, por fuente. */
  saveReachSources(
    channelId: string,
    rows: ReturnType<typeof sumBySource>,
    fetchedAt: Date,
  ): Promise<void>;
}

export interface ReachResult {
  channelId: string;
  ok: boolean;
  jobsCreated: number;
  reports: number;
  rows: number;
  requests: number;
  error: string | null;
  needsReauth: boolean;
}

/**
 * Trae el alcance de un canal: asegura los dos trabajos (los crea la primera
 * vez) y descarga los reportes nuevos, del más viejo al más nuevo, para que un
 * reporte regenerado de un día reemplace al anterior.
 */
export async function syncReach(
  conn: StoredConnection,
  opts: {
    oauth: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">;
    store: ReachStore;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
): Promise<ReachResult> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result: ReachResult = {
    channelId: conn.channelId,
    ok: false,
    jobsCreated: 0,
    reports: 0,
    rows: 0,
    requests: 0,
    error: null,
    needsReauth: false,
  };
  let client: YouTubeReportingClient | null = null;
  try {
    const token = await freshAccessToken(conn, opts.oauth, opts.store, fetchImpl, now);
    client = new YouTubeReportingClient(token, fetchImpl);
    const state: ReportingState = { ...(await opts.store.reportingState(conn.channelId)) };
    let existing: ReportingJob[] | null = null;

    for (const type of Object.values(REACH_REPORTS)) {
      let entry = state[type];
      if (!entry) {
        existing ??= await client.listJobs();
        const found = existing.find((j) => j.reportTypeId === type);
        const job = found ?? (await client.createJob(type, `Planificador · ${type}`));
        if (!found) result.jobsCreated++;
        entry = { jobId: job.id, after: null };
        state[type] = entry;
        await opts.store.saveReportingState(conn.channelId, state);
      }
      const reports = (await client.listReports(entry.jobId, entry.after)).sort((a, b) =>
        a.createTime.localeCompare(b.createTime),
      );
      for (const r of reports) {
        const rows = parseReachCsv(await client.download(r.downloadUrl));
        if (type === REACH_REPORTS.basic) await opts.store.saveReach(conn.channelId, rows, now);
        else await opts.store.saveReachSources(conn.channelId, sumBySource(rows), now);
        result.reports++;
        result.rows += rows.length;
        entry.after = r.createTime;
        await opts.store.saveReportingState(conn.channelId, state);
      }
    }
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    if (
      (err instanceof OAuthError && err.needsReauth) ||
      (err instanceof YouTubeApiError && err.unauthorized)
    ) {
      result.needsReauth = true;
      await opts.store.markNeedsReauth(conn.channelId, result.error);
    }
  }
  result.requests = client?.requests ?? 0;
  return result;
}
