import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  CAPSULE_KINDS,
  networkRules,
  validatePost,
  videoLink,
  type CapsuleKind,
} from "@planificador/core";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { AiRefusalError, type AiConfig } from "./generate";
import type { StreamClient } from "./stages";
import { verificationTable, type Claim } from "./verification";

/**
 * Redes y cápsulas (Fase 4 · paso 6): de cada episodio, 3 posts de texto por
 * red del canal (el dato, el mito y la postura), con la forma de cada red.
 * Salen del guion verificado, los reels R1–R3 y la postura; el enlace al
 * video no va en el texto: lo agrega la app al copiar.
 */

const schema = z.object({
  posts: z.array(
    z.object({
      network: z.string().describe("La clave de la red, tal cual viene en la lista."),
      kind: z.enum(CAPSULE_KINDS).describe("dato, mito o postura."),
      text: z.string().describe("El post listo para pegar, sin enlaces."),
    }),
  ),
});

export type SocialPost = { network: string; kind: CapsuleKind; text: string };

export interface SocialPostsInput {
  episodeTitle: string;
  /** La postura del episodio. */
  stance: string;
  /** El guion verificado. */
  script: string;
  /** Los reels R1–R3 tal como los dejó el guion. */
  reels: string;
  claims: Claim[];
  /** La sección 13 de la guía del guionista. */
  guide: string;
  /** Las redes para las que se escribe (clave y nombre). */
  networks: { network: string; label: string }[];
}

/** Lugar que se reserva para el enlace al video, que la app agrega al copiar. */
const LINK = videoLink("XXXXXXXXXXX");

const SYSTEM = [
  "Escribes posts de texto para redes como Diego, el presentador de un canal de tecnología en YouTube. Respondes en español.",
  "Por cada red de la lista escribes exactamente 3 posts (cápsulas), uno de cada tipo:",
  "- dato: el dato principal del episodio, con su contexto y por qué importa. Solo cifras de la tabla de verificación en estado verified o nuanced (con su matiz); nunca inventes ni redondees cifras.",
  "- mito: una creencia común que el episodio desmiente, y lo que es cierto según el guion.",
  "- postura: la postura del episodio, en primera persona y sin tibieza: qué recomienda Diego y para quién.",
  "Voz de Diego: tuteo, español latinoamericano neutro, cercano y directo; sin emojis, sin fórmulas de marketing, sin «¡No te lo pierdas!». Cada post se sostiene solo, aunque no hayan visto el video, y puede invitar a verlo completo.",
  "Sin enlaces en el texto: la app agrega el enlace al video al final al copiar, y ya se descontó del tope. Los hashtags, si van, al final y sin pasarse del máximo de la red.",
  "Adapta cada post a su red (largo, ritmo y estilo de la lista): no copies el mismo texto en dos redes. Los reels R1–R3 son la mejor fuente de ganchos.",
].join("\n");

function networkList(networks: SocialPostsInput["networks"]) {
  return networks
    .map((n) => {
      const r = networkRules(n.network, n.label);
      const max = r.limit - (r.key === "x" ? 25 : LINK.length + 2);
      return `- ${n.network} (${r.label}): ${max} caracteres como máximo; ${r.hashtags} hashtags como máximo. ${r.style}`;
    })
    .join("\n");
}

/** Escribe las cápsulas y corrige una vez las que no cumplen la forma de su red. */
export async function writeSocialPosts(
  client: StreamClient,
  config: AiConfig,
  input: SocialPostsInput,
): Promise<{ posts: SocialPost[]; repaired: number; usage: UsageTotals; model: string }> {
  let usage = emptyUsage();
  const call = async (system: string, user: string) => {
    const res = await client.beta.messages.parse({
      model: config.model,
      max_tokens: 16_000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      ...(config.fallbacks && {
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default" as const,
      }),
    });
    if (res.stop_reason === "refusal") {
      const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
      throw new AiRefusalError(details?.category ?? null);
    }
    usage = addUsage(usage, res.usage);
    return res;
  };

  const res = await call(
    SYSTEM,
    [
      `Episodio: ${input.episodeTitle}`,
      "",
      "## Redes (clave, tope sin el enlace, hashtags y estilo)",
      networkList(input.networks),
      "",
      "## Postura del episodio",
      input.stance.trim() || "(sin postura: sácala del guion)",
      "",
      "## Sección 13 de la guía",
      input.guide.trim() || "(sin guía)",
      "",
      "## Reels R1–R3",
      input.reels.trim() || "(sin reels)",
      "",
      "## Tabla de verificación",
      verificationTable(input.claims),
      "",
      "## Guion verificado",
      input.script.trim() || "(sin guion)",
    ].join("\n"),
  );
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("Los posts para redes llegaron incompletos");

  // Uno por red y tipo, solo de las redes pedidas.
  const wanted = new Set(input.networks.map((n) => n.network));
  const byKey = new Map<string, SocialPost>();
  for (const p of parsed.posts) {
    const k = `${p.network}:${p.kind}`;
    if (!wanted.has(p.network) || byKey.has(k)) continue;
    byKey.set(k, { network: p.network, kind: p.kind, text: p.text.trim() });
  }
  let posts = [...byKey.values()];

  // Una vuelta de corrección para los que se pasan de la forma de su red.
  const problems = posts
    .map((p, i) => ({ i, reasons: validatePost(p.network, p.text, LINK) }))
    .filter((p) => p.reasons.length);
  let repaired = 0;
  if (problems.length) {
    try {
      const fix = await call(
        [
          "Corriges posts para redes que no cumplen la forma de su red. Respondes en español.",
          "Devuelves exactamente los mismos posts (misma red y mismo tipo), con la misma idea y la voz de Diego: solo cambias lo necesario para cumplir los motivos. Sin enlaces ni emojis. Cuenta los caracteres antes de responder.",
        ].join("\n"),
        [
          "## Redes",
          networkList(input.networks),
          "",
          "## Posts que corregir (con sus motivos)",
          JSON.stringify(
            problems.map((p) => ({ ...posts[p.i], motivos: p.reasons })),
            null,
            2,
          ),
        ].join("\n"),
      );
      const fixed = fix.parsed_output?.posts ?? [];
      const bad = new Set(problems.map((p) => p.i));
      posts = posts.map((p, i) => {
        const f = fixed.find((x) => x.network === p.network && x.kind === p.kind);
        if (!f || !bad.has(i)) return p;
        const next = { ...p, text: f.text.trim() };
        if (!validatePost(next.network, next.text, LINK).length) repaired++;
        return next;
      });
    } catch (err) {
      if (err instanceof AiRefusalError) throw err;
      // Sin corrección: quedan como vinieron y el panel los marca.
    }
  }
  return { posts, repaired, usage, model: res.model };
}
