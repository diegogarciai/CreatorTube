import { describe, expect, it, vi } from "vitest";
import { fetchNewComments, QUOTA_COST, YouTubeClient } from "../src";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const thread = (id: string, opts: { author?: string; reply?: string } = {}) => ({
  id: `t-${id}`,
  snippet: {
    totalReplyCount: opts.reply ? 1 : 0,
    topLevelComment: {
      id,
      snippet: {
        authorDisplayName: `Persona ${id}`,
        authorChannelId: { value: opts.author ?? `UC-${id}` },
        textOriginal: `Comentario ${id}`,
        likeCount: 2,
        publishedAt: "2026-10-05T10:00:00Z",
      },
    },
  },
  ...(opts.reply && {
    replies: { comments: [{ snippet: { authorChannelId: { value: opts.reply } } }] },
  }),
});

describe("comentarios", () => {
  it("lee los hilos del video, del más nuevo al más viejo, y marca si el canal respondió", async () => {
    const fetchImpl = vi.fn(async (_u: string) =>
      json({ items: [thread("c1", { reply: "UCcanal" }), thread("c2")] }),
    );
    const client = new YouTubeClient("tok", fetchImpl as unknown as typeof fetch);
    const page = await client.listCommentThreads("vid1", { channelYouTubeId: "UCcanal" });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.pathname).toBe("/youtube/v3/commentThreads");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      videoId: "vid1",
      order: "time",
      textFormat: "plainText",
      part: "snippet,replies",
    });
    expect(page.comments.map((c) => [c.id, c.channelReplied])).toEqual([
      ["c1", true],
      ["c2", false],
    ]);
    expect(page.comments[0]).toMatchObject({
      authorName: "Persona c1",
      text: "Comentario c1",
      likeCount: 2,
    });
    expect(client.quotaUsed).toBe(QUOTA_COST.read);
  });

  it("trae solo lo nuevo: corta en el primer comentario ya leído y salta los del canal", async () => {
    const pages = [
      {
        items: [thread("n1"), thread("own", { author: "UCcanal" }), thread("n2")],
        nextPageToken: "p2",
      },
      { items: [thread("n3"), thread("old"), thread("older")], nextPageToken: "p3" },
    ];
    const fetchImpl = vi.fn(async (u: string) =>
      json(new URL(u).searchParams.get("pageToken") === "p2" ? pages[1] : pages[0]),
    );
    const client = new YouTubeClient("tok", fetchImpl as unknown as typeof fetch);
    const fresh = await fetchNewComments(client, "vid1", {
      knownIds: new Set(["old"]),
      channelYouTubeId: "UCcanal",
    });
    expect(fresh.map((c) => c.id)).toEqual(["n1", "n2", "n3"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("responder cuesta 50 unidades y devuelve el id de la respuesta", async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => json({ id: "reply-1" }));
    const client = new YouTubeClient("tok", fetchImpl as unknown as typeof fetch);
    expect(await client.replyToComment("c1", "Gracias por el dato del brillo.")).toBe("reply-1");
    const [u, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(u).pathname).toBe("/youtube/v3/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      snippet: { parentId: "c1", textOriginal: "Gracias por el dato del brillo." },
    });
    expect(client.quotaUsed).toBe(QUOTA_COST.write);
  });
});
