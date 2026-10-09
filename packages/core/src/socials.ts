/**
 * Redes y cápsulas (Fase 4 · paso 6): las redes del canal y las reglas de
 * forma de cada una. De cada episodio salen 3 cápsulas por red (el dato, el
 * mito y la postura), que se editan, se copian y se marcan publicadas.
 */

export const CAPSULE_KINDS = ["dato", "mito", "postura"] as const;
export type CapsuleKind = (typeof CAPSULE_KINDS)[number];

export const POST_STATUSES = ["suggested", "edited", "published", "dismissed"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export type SocialNetwork = {
  key: string;
  label: string;
  /** Tope de caracteres del post (con el enlace, si se copia con él). */
  limit: number;
  /** Cuántos hashtags como máximo. */
  hashtags: number;
  /** Cómo escribir en esa red, para el prompt. */
  style: string;
  /** Otros nombres con que se guarda («Twitter» → X). */
  aliases?: readonly string[];
};

export const SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  {
    key: "x",
    label: "X",
    limit: 280,
    hashtags: 1,
    style: "Una idea por post, directa, sin hilo. La primera frase tiene que parar el scroll.",
    aliases: ["twitter", "x (twitter)", "x.com"],
  },
  {
    key: "threads",
    label: "Threads",
    limit: 500,
    hashtags: 1,
    style: "Conversacional, como se lo contarías a alguien. Puede cerrar con una pregunta.",
  },
  {
    key: "bluesky",
    label: "Bluesky",
    limit: 300,
    hashtags: 1,
    style: "Corto y directo, sin tono de marca.",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    limit: 3000,
    hashtags: 3,
    style:
      "De 600 a 1300 caracteres. Primera línea que engancha, párrafos cortos con líneas en blanco, una lección práctica y una pregunta al final.",
  },
  {
    key: "instagram",
    label: "Instagram",
    limit: 2200,
    hashtags: 5,
    style:
      "Pie de foto: la primera línea fuerte (se corta a los 125 caracteres), luego 2 o 3 párrafos cortos. Los hashtags al final.",
  },
  {
    key: "facebook",
    label: "Facebook",
    limit: 500,
    hashtags: 2,
    style: "Cercano y claro, de 1 a 3 párrafos cortos.",
  },
  {
    key: "tiktok",
    label: "TikTok",
    limit: 2200,
    hashtags: 4,
    style: "Pie corto: una frase gancho y el dato. Los hashtags al final.",
  },
];

/** Las reglas de una red que no está en el catálogo. */
export const GENERIC_NETWORK: Omit<SocialNetwork, "key" | "label"> = {
  limit: 500,
  hashtags: 2,
  style: "Claro y directo, de 1 a 3 párrafos cortos.",
};

const norm = (s: string) => s.trim().toLowerCase();

/** La red del catálogo para un nombre guardado, o `null` si no está. */
export function findNetwork(name: string): SocialNetwork | null {
  const n = norm(name);
  return (
    SOCIAL_NETWORKS.find((s) => s.key === n || norm(s.label) === n || s.aliases?.includes(n)) ??
    null
  );
}

/** Clave estable de una red: la del catálogo o el nombre en minúsculas. */
export const networkKey = (name: string) => findNetwork(name)?.key ?? norm(name);

/** Las reglas de una red por su clave (o las genéricas, con ese nombre). */
export function networkRules(key: string, label = key): SocialNetwork {
  return findNetwork(key) ?? { key: norm(key), label, ...GENERIC_NETWORK };
}

export type ChannelSocial = { network: string; label: string; url: string };

/**
 * Las redes del canal desde `distribution_settings.socials`, que se guarda
 * como `{ nombre: enlace }` (así lo lee también el guion). Se saltan las
 * vacías y las repetidas.
 */
export function parseSocials(value: unknown): ChannelSocial[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const out: ChannelSocial[] = [];
  const seen = new Set<string>();
  for (const [name, url] of Object.entries(value as Record<string, unknown>)) {
    if (typeof url !== "string" || !name.trim()) continue;
    const net = findNetwork(name);
    const network = net?.key ?? norm(name);
    if (seen.has(network)) continue;
    seen.add(network);
    out.push({ network, label: net?.label ?? name.trim(), url: url.trim() });
  }
  return out;
}

/** La forma que se guarda: `{ nombre: enlace }`, con el nombre del catálogo. */
export function socialsToJson(socials: readonly { label: string; url: string }[]) {
  const out: Record<string, string> = {};
  for (const s of socials) {
    const label = findNetwork(s.label)?.label ?? s.label.trim();
    if (label) out[label] = s.url.trim();
  }
  return out;
}

/** Enlace corto al video del episodio. */
export const videoLink = (youtubeVideoId: string) =>
  `https://youtu.be/${encodeURIComponent(youtubeVideoId)}`;

/** En X un enlace cuenta 23; en las demás, lo que mide. */
const linkCost = (network: string, link: string) => (network === "x" ? 23 : link.length);

/** Caracteres como los cuenta una persona (los emojis y acentos, como uno). */
export const postLength = (text: string) => [...text].length;

/** El texto que se copia: el post y, si se pide, el enlace al video al final. */
export const postWithLink = (text: string, link: string | null) =>
  link ? `${text.trim()}\n\n${link}` : text.trim();

/** Cuánto mide el post en esa red, con el enlace si se copia con él. */
export function postSize(network: string, text: string, link: string | null) {
  return postLength(text.trim()) + (link ? 2 + linkCost(network, link) : 0);
}

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const EMOJI = /\p{Extended_Pictographic}/u;
const URL_RE = /\bhttps?:\/\/|\bwww\./i;

/**
 * Lo que está mal en un post, en palabras para corregirlo (vacío si está
 * bien): el tope de la red (con el enlace al video si se copia con él), los
 * hashtags de más, los emojis y los enlaces dentro del texto.
 */
export function validatePost(network: string, text: string, link: string | null = null): string[] {
  const rules = networkRules(network);
  const t = text.trim();
  if (!t) return ["El post está vacío."];
  const problems: string[] = [];
  const size = postSize(rules.key, t, link);
  if (size > rules.limit)
    problems.push(
      `Mide ${size} caracteres${link ? " con el enlace" : ""}; el tope en ${rules.label} es ${rules.limit}.`,
    );
  const tags = t.match(HASHTAG)?.length ?? 0;
  if (tags > rules.hashtags)
    problems.push(`Tiene ${tags} hashtags; en ${rules.label} van ${rules.hashtags} como máximo.`);
  if (EMOJI.test(t)) problems.push("Tiene emojis; van sin emojis.");
  if (URL_RE.test(t)) problems.push("Tiene un enlace; el del video lo agrega la app al copiar.");
  return problems;
}

/**
 * Las cápsulas que faltan por red: las redes del canal menos las que ya
 * tienen post (un post publicado o editado nunca se reescribe; «Rehacer»
 * borra antes los no publicados de esa red).
 */
export function missingCapsules(
  networks: readonly string[],
  existing: readonly { network: string; kind: string }[],
): { network: string; kinds: CapsuleKind[] }[] {
  const have = new Set(existing.map((p) => `${p.network}:${p.kind}`));
  return networks
    .map((network) => ({
      network,
      kinds: CAPSULE_KINDS.filter((k) => !have.has(`${network}:${k}`)),
    }))
    .filter((n) => n.kinds.length);
}
