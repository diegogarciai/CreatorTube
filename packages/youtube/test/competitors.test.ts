import { describe, expect, it, vi } from "vitest";
import { parseChannelRef, recentPublicVideos, YouTubeClient } from "../src";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("competencia", () => {
  it("lee canales desde enlaces, @handles e ids", () => {
    expect(parseChannelRef("https://www.youtube.com/@Gartechs/videos")).toEqual({
      handle: "@Gartechs",
    });
    expect(parseChannelRef("@mkbhd")).toEqual({ handle: "@mkbhd" });
    expect(parseChannelRef("mkbhd")).toEqual({ handle: "@mkbhd" });
    expect(parseChannelRef("https://youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ")).toEqual({
      id: "UCBJycsmduvYEL83R_U4JriQ",
    });
    expect(parseChannelRef("UCBJycsmduvYEL83R_U4JriQ")).toEqual({ id: "UCBJycsmduvYEL83R_U4JriQ" });
    expect(parseChannelRef("https://example.com/algo")).toBeNull();
    expect(parseChannelRef("  ")).toBeNull();
  });

  it("busca el canal por handle y trae sus subidas públicas con vistas", async () => {
    const urls: URL[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      if (url.pathname.endsWith("/channels"))
        return json({
          items: [
            {
              id: "UCx",
              snippet: { title: "Otro canal", customUrl: "@otro" },
              contentDetails: { relatedPlaylists: { uploads: "UUx" } },
              statistics: { subscriberCount: "1200" },
            },
          ],
        });
      if (url.pathname.endsWith("/playlistItems"))
        return json({
          items: [{ contentDetails: { videoId: "a" } }, { contentDetails: { videoId: "b" } }],
        });
      return json({
        items: [
          {
            id: "a",
            snippet: { title: "A", publishedAt: "2026-10-01T00:00:00Z" },
            status: { privacyStatus: "public" },
            statistics: { viewCount: "900" },
          },
          {
            id: "b",
            snippet: { title: "B", publishedAt: "2026-10-02T00:00:00Z" },
            status: { privacyStatus: "private" },
            statistics: {},
          },
        ],
      });
    });
    const client = new YouTubeClient("tok", fetchImpl as unknown as typeof fetch);
    const ch = await client.getChannel({ handle: "@otro" });
    expect(ch).toMatchObject({
      id: "UCx",
      title: "Otro canal",
      uploadsPlaylistId: "UUx",
      subscriberCount: 1200,
    });
    expect(urls[0]!.searchParams.get("forHandle")).toBe("@otro");
    const videos = await recentPublicVideos(client, "UUx");
    expect(videos.map((v) => [v.id, v.viewCount])).toEqual([["a", 900]]);
    expect(urls[1]!.searchParams.get("maxResults")).toBe("30");
    expect(client.quotaUsed).toBe(3);
  });
});
