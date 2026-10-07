import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildAuthUrl,
  createState,
  decryptSecret,
  encryptSecret,
  parseIsoDuration,
  parseKey,
  shouldSync,
  syncChannel,
  verifyState,
  type LinkedEpisode,
  type SyncStore,
} from "../src";

const key = randomBytes(32);

describe("cifrado de tokens", () => {
  it("ida y vuelta, con IV distinto cada vez", () => {
    const a = encryptSecret("1//refresh-token", key);
    const b = encryptSecret("1//refresh-token", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("1//refresh-token");
  });
  it("detecta manipulación y clave equivocada", () => {
    const enc = encryptSecret("secreto", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("otro").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
  });
  it("valida la clave", () => {
    expect(() => parseKey(undefined)).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(parseKey(key.toString("base64")).length).toBe(32);
  });
});

describe("state de OAuth", () => {
  const data = { workspaceId: "w1", userId: "u1" };
  it("acepta el state firmado con el nonce de la cookie", () => {
    const { state, nonce } = createState(data, key, 1000);
    expect(verifyState(state, key, nonce, 2000)).toMatchObject(data);
  });
  it("rechaza nonce distinto, vencido o firma alterada", () => {
    const { state, nonce } = createState(data, key, 1000);
    expect(verifyState(state, key, "otro", 2000)).toBeNull();
    expect(verifyState(state, key, nonce, 1000 + 11 * 60_000)).toBeNull();
    expect(verifyState(state.slice(0, -2) + "xx", key, nonce, 2000)).toBeNull();
    expect(verifyState(state, randomBytes(32), nonce, 2000)).toBeNull();
  });
  it("URL de autorización con acceso offline y permisos de lectura", () => {
    const url = new URL(
      buildAuthUrl({ clientId: "cid", clientSecret: "s", redirectUri: "https://app/cb" }, "st"),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("youtube.readonly");
    expect(url.searchParams.get("state")).toBe("st");
  });
});

describe("API", () => {
  it("duraciones ISO 8601", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("P1DT1M")).toBe(86460);
    expect(parseIsoDuration("raro")).toBeNull();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeYouTube(
  videos: Record<string, { privacy: string; publishAt?: string; publishedAt?: string }>,
) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") {
      return jsonResponse({ access_token: "nuevo", expires_in: 3600, scope: "a b" });
    }
    if (url.pathname.endsWith("/channels")) {
      return jsonResponse({
        items: [
          {
            id: "UC1",
            snippet: { title: "Canal" },
            contentDetails: { relatedPlaylists: { uploads: "UU1" } },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/playlistItems")) {
      return jsonResponse({
        items: Object.keys(videos).map((id) => ({ contentDetails: { videoId: id } })),
      });
    }
    if (url.pathname.endsWith("/videos")) {
      const ids = url.searchParams.get("id")!.split(",");
      return jsonResponse({
        items: ids.map((id) => ({
          id,
          snippet: {
            title: `Video ${id}`,
            description: "",
            publishedAt: videos[id]!.publishedAt ?? "2026-10-01T00:00:00Z",
          },
          status: { privacyStatus: videos[id]!.privacy, publishAt: videos[id]!.publishAt },
          statistics: { viewCount: "10" },
          contentDetails: { duration: "PT10M" },
        })),
      });
    }
    return jsonResponse({}, 404);
  });
}

function memoryStore(episodes: LinkedEpisode[]) {
  const calls = {
    tokens: [] as unknown[],
    reauth: [] as string[],
    videos: 0,
    updates: [] as { id: string; status: string }[],
    syncs: [] as { quotaUsed: number; error: string | null }[],
  };
  const store: SyncStore = {
    saveTokens: async (_c, t) => void calls.tokens.push(t),
    markNeedsReauth: async (_c, e) => void calls.reauth.push(e),
    upsertVideos: async (_c, v) => void (calls.videos += v.length),
    linkedEpisodes: async (_c, ids) =>
      episodes.filter((e) => e.youtubeVideoId && ids.includes(e.youtubeVideoId)),
    updateEpisode: async (id, change) => void calls.updates.push({ id, status: change.status }),
    recordSync: async (_c, r) => void calls.syncs.push(r),
  };
  return { store, calls };
}

const baseEpisode: Omit<LinkedEpisode, "id" | "youtubeVideoId" | "status" | "stage"> = {
  publishDate: null,
  recordDate: null,
  publishedOn: null,
  evaluatedAt: null,
  archivedAt: null,
};

describe("sincronización", () => {
  const now = new Date("2026-10-07T15:00:00Z");
  const oauth = { clientId: "c", clientSecret: "s" };

  it("refresca el token, guarda videos y avanza episodios", async () => {
    const fetchImpl = fakeYouTube({
      aaaaaaaaaaa: { privacy: "public" },
      bbbbbbbbbbb: { privacy: "private", publishAt: "2026-10-09T15:00:00Z" },
      ccccccccccc: { privacy: "private" },
    });
    const { store, calls } = memoryStore([
      {
        ...baseEpisode,
        id: "e1",
        youtubeVideoId: "aaaaaaaaaaa",
        status: "scheduled",
        stage: "publication",
      },
      {
        ...baseEpisode,
        id: "e2",
        youtubeVideoId: "bbbbbbbbbbb",
        status: "editing",
        stage: "publication",
      },
      {
        ...baseEpisode,
        id: "e3",
        youtubeVideoId: "ccccccccccc",
        status: "editing",
        stage: "publication",
      },
    ]);
    const result = await syncChannel(
      {
        channelId: "ch",
        timezone: "America/Bogota",
        accessToken: "viejo",
        refreshToken: "r",
        tokenExpiresAt: new Date(now.getTime() + 30_000),
      },
      { oauth, store, fetchImpl: fetchImpl as unknown as typeof fetch, now },
    );
    expect(result).toMatchObject({ ok: true, videos: 3, advanced: 2, quotaUsed: 3 });
    expect(calls.tokens).toHaveLength(1);
    expect(calls.updates).toEqual([
      { id: "e1", status: "published" },
      { id: "e2", status: "scheduled" },
    ]);
    expect(calls.syncs).toEqual([{ quotaUsed: 3, error: null }]);
  });

  it("marca reconexión si Google revocó el acceso", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 400));
    const { store, calls } = memoryStore([]);
    const result = await syncChannel(
      {
        channelId: "ch",
        timezone: "UTC",
        accessToken: null,
        refreshToken: "r",
        tokenExpiresAt: null,
      },
      { oauth, store, fetchImpl: fetchImpl as unknown as typeof fetch, now },
    );
    expect(result).toMatchObject({ ok: false, needsReauth: true });
    expect(calls.reauth).toHaveLength(1);
  });

  it("frecuencia según cercanía de publicación", () => {
    const base = { now, timezone: "America/Bogota", hasScheduled: false };
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
    expect(shouldSync({ ...base, lastSyncedAt: null, upcomingPublishDates: [] })).toBe(true);
    expect(
      shouldSync({ ...base, lastSyncedAt: hoursAgo(1), upcomingPublishDates: ["2026-10-08"] }),
    ).toBe(true);
    expect(
      shouldSync({ ...base, lastSyncedAt: hoursAgo(1), upcomingPublishDates: ["2026-10-30"] }),
    ).toBe(false);
    expect(shouldSync({ ...base, lastSyncedAt: hoursAgo(6), upcomingPublishDates: [] })).toBe(true);
  });
});
