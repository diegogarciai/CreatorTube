import { describe, expect, it } from "vitest";
import {
  missingCapsules,
  networkKey,
  networkRules,
  parseSocials,
  postSize,
  postWithLink,
  socialsToJson,
  validatePost,
  videoLink,
} from "../src";

describe("redes", () => {
  it("lee las redes guardadas como { nombre: enlace }, con alias y sin vacías ni repetidas", () => {
    expect(
      parseSocials({
        Twitter: "https://x.com/diego ",
        LinkedIn: "https://linkedin.com/in/diego",
        x: "https://x.com/otro",
        Mastodon: "https://mastodon.social/@diego",
        Vacia: 3,
      }),
    ).toEqual([
      { network: "x", label: "X", url: "https://x.com/diego" },
      { network: "linkedin", label: "LinkedIn", url: "https://linkedin.com/in/diego" },
      { network: "mastodon", label: "Mastodon", url: "https://mastodon.social/@diego" },
    ]);
    expect(parseSocials(null)).toEqual([]);
    expect(parseSocials(["x"])).toEqual([]);
  });

  it("guarda con el nombre del catálogo", () => {
    expect(
      socialsToJson([
        { label: "twitter", url: " https://x.com/d " },
        { label: "Mastodon", url: "https://m.s/@d" },
      ]),
    ).toEqual({ X: "https://x.com/d", Mastodon: "https://m.s/@d" });
  });

  it("una red fuera del catálogo usa las reglas genéricas", () => {
    expect(networkKey("Mastodon")).toBe("mastodon");
    expect(networkRules("mastodon", "Mastodon")).toMatchObject({ label: "Mastodon", limit: 500 });
    expect(networkRules("x").limit).toBe(280);
  });

  it("en X el enlace cuenta 23; en las demás, lo que mide", () => {
    const link = videoLink("abc123DEF45");
    expect(link).toBe("https://youtu.be/abc123DEF45");
    expect(postSize("x", "hola", link)).toBe(4 + 2 + 23);
    expect(postSize("threads", "hola", link)).toBe(4 + 2 + link.length);
    expect(postSize("x", "  hola ", null)).toBe(4);
    expect(postWithLink(" hola ", link)).toBe(`hola\n\n${link}`);
    expect(postWithLink("hola", null)).toBe("hola");
  });

  it("valida el tope (con el enlace), los hashtags, los emojis y los enlaces", () => {
    const link = videoLink("abc");
    expect(validatePost("x", "a".repeat(280))).toEqual([]);
    expect(validatePost("x", "a".repeat(260), link)[0]).toMatch(/285 caracteres con el enlace/);
    expect(validatePost("x", "Dato #uno #dos")[0]).toMatch(/2 hashtags/);
    expect(validatePost("linkedin", "Dato #uno #dos #tres")).toEqual([]);
    expect(validatePost("threads", "Mira esto 🔥")).toEqual(["Tiene emojis; van sin emojis."]);
    expect(validatePost("threads", "Más en https://ejemplo.com")[0]).toMatch(/enlace/);
    expect(validatePost("x", "   ")).toEqual(["El post está vacío."]);
    expect(validatePost("x", "Precio: US$999, ¿vale la pena? Sí: más acentos ñ")).toEqual([]);
  });
});

describe("cápsulas que faltan", () => {
  it("solo las redes y tipos sin post", () => {
    expect(
      missingCapsules(
        ["x", "linkedin"],
        [
          { network: "x", kind: "dato" },
          { network: "x", kind: "mito" },
          { network: "x", kind: "postura" },
          { network: "linkedin", kind: "dato" },
          { network: "tiktok", kind: "dato" },
        ],
      ),
    ).toEqual([{ network: "linkedin", kinds: ["mito", "postura"] }]);
    expect(missingCapsules(["x"], [])).toEqual([
      { network: "x", kinds: ["dato", "mito", "postura"] },
    ]);
  });
});
