import { describe, expect, it } from "vitest";
import {
  assetsSuggestion,
  cleanKeywords,
  episodePatchFromAssets,
  extractAssets,
  parseAssets,
  type PublicationAssets,
} from "../src/publication";
import {
  buildStepPrompt,
  runSteps,
  STAGE_STEPS,
  stepInputs,
  stepPrerequisites,
  type StageContext,
  type StepBodies,
} from "../src/stages";

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const assets: PublicationAssets = {
  titulos: ["Uno", "Dos", "Tres"],
  miniaturas: [],
  descripcion: "Texto",
  capitulos: [{ tiempo: "0:00", titulo: "Inicio" }],
  etiquetas: ["a"],
  comentario_fijado: "¿Y tú?",
  fuentes: [{ titulo: "Fuente", url: "https://a.com" }],
  postura: "Depende",
  tipo: "Compra",
  publico: "Ingenieros",
  keywords: ["portátil nuevo", " Portatil nuevo ", "mejor portátil 2026", ""],
  pilar: "compras",
};

const pillars = [
  { id: "p1", name: "Compras" },
  { id: "p2", name: "Seguridad" },
];

describe("pasos de Publicación y Podcast", () => {
  it("Publicación 4 pasos y Podcast 2, con sus secciones de la guía", () => {
    expect(STAGE_STEPS.publication!.map((s) => [s.title, s.guide, Boolean(s.special)])).toEqual([
      ["REELS R1, R2 Y R3", "publication", false],
      ["ASSETS DE PUBLICACIÓN", "publication", false],
      ["FICHA DEL EPISODIO", "publication", false],
      ["ASSETS EN JSON", "publication", true],
    ]);
    // El JSON se muestra tal cual, no como Markdown.
    expect(STAGE_STEPS.publication!.at(-1)!.plain).toBe(true);
    expect(STAGE_STEPS.podcast!.map((s) => [s.title, s.guide, s.plain])).toEqual([
      ["GUION DEL PODCAST", "podcast", true],
      ["DESCRIPCIÓN DEL PODCAST", "podcast", true],
    ]);
  });

  it("cada paso recibe solo lo que usa, nunca el teleprompter sin verificar", () => {
    const bodies: StepBodies = {
      outline: "esc",
      teleprompter: "sin verificar",
      quality: "cal",
      verify: "tabla",
      fix: "verificado",
      motion: "mg",
      broll: "br",
      reels_final: "r1",
      assets: "as",
      sheet: "fi",
      podcast_script: "pod",
    };
    const titles = (key: Parameters<typeof stepInputs>[0]) =>
      stepInputs(key, bodies).map((b) => b.body);
    expect(titles("reels_final")).toEqual(["verificado", "mg"]);
    expect(titles("assets")).toEqual(["esc", "tabla", "verificado"]);
    expect(titles("sheet")).toEqual(["esc", "cal", "tabla", "verificado", "r1", "mg"]);
    expect(titles("assets_json")).toEqual(["as", "fi"]);
    expect(titles("podcast_script")).toEqual(["tabla", "verificado"]);
    expect(titles("podcast_desc")).toEqual(["tabla", "pod"]);
    for (const s of [...STAGE_STEPS.publication!, ...STAGE_STEPS.podcast!]) {
      expect(titles(s.key)).not.toContain("sin verificar");
    }
  });

  it("el Podcast no espera a Publicación y una corrida normal no lo genera", () => {
    const keys = (specs: { key: string }[]) => specs.map((s) => s.key);
    expect(keys(stepPrerequisites("podcast_script"))).not.toContain("assets");
    expect(keys(stepPrerequisites("podcast_script"))).toContain("broll");
    expect(keys(stepPrerequisites("podcast_desc")).at(-1)).toBe("podcast_script");
    expect(keys(stepPrerequisites("sheet")).slice(-3)).toEqual(["broll", "reels_final", "assets"]);
    expect(keys(runSteps("dossier")).at(-1)).toBe("assets_json");
    expect(keys(runSteps("motion"))).not.toContain("podcast_script");
    expect(keys(runSteps("podcast_script"))).toEqual(["podcast_script", "podcast_desc"]);
  });

  it("Publicación recibe pilares, podcast y redes; el Guion no", () => {
    const ctx: StageContext = {
      guideSections: "14. ASSETS",
      presenter: "Diego",
      today: "2026-10-08",
      timezone: "America/Bogota",
      episodeCode: "GT-1",
      title: "Tema",
      stance: "",
      stanceConfirmed: false,
      notes: "",
      pillar: null,
      targetMinutes: 10,
      episodeType: null,
      ownMeasurements: "",
      sponsorship: null,
      directionBlock: null,
      channel: {
        newsletter: "El Punto",
        nextVideo: null,
        published: [],
        pillars: ["Compras", "Seguridad"],
        podcastName: "Tecnología con criterio",
        socials: [{ name: "Instagram", url: "https://instagram.com/gartechs" }],
      },
      previous: [],
    };
    const pub = buildStepPrompt("assets", ctx);
    expect(pub.shared).toContain("ETAPA: Publicación (4 de 5)");
    expect(pub.shared).toContain("con el nombre exacto): Compras, Seguridad");
    expect(pub.shared).toContain("Redes del canal: Instagram: https://instagram.com/gartechs");
    expect(pub.task).toContain("PASO 2 de 4.");
    const pod = buildStepPrompt("podcast_desc", ctx);
    expect(pod.shared).toContain("Nombre del podcast: Tecnología con criterio");
    expect(pod.shared).not.toContain("Pilares del canal");
    const script = buildStepPrompt("outline", ctx);
    expect(script.shared).not.toContain("Pilares del canal");
    expect(script.shared).not.toContain("Redes del canal");
  });
});

describe("assets en JSON", () => {
  it("pide la salida estructurada con los assets y la ficha", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          parse: async (params: Record<string, unknown>) => {
            calls.push(params);
            return { model: "m", stop_reason: "end_turn", usage, parsed_output: assets };
          },
        },
      },
    } as never;
    const out = await extractAssets(
      client,
      { model: "m" },
      {
        system: "S",
        shared: "C",
        blocks: [
          { title: "ASSETS DE PUBLICACIÓN", body: "as" },
          { title: "FICHA DEL EPISODIO", body: "fi" },
        ],
      },
    );
    expect(out.assets).toEqual(assets);
    expect(out.usage.input_tokens).toBe(100);
    const content = (calls[0] as { messages: { content: { text: string }[] }[] }).messages[0]!
      .content;
    expect(content.map((c) => c.text.split("\n")[0])).toEqual([
      "C",
      "### BLOQUE: ASSETS DE PUBLICACIÓN",
      "### BLOQUE: FICHA DEL EPISODIO",
      expect.stringContaining("PASO 4 de 4"),
    ]);
  });

  it("lee el JSON guardado; si no es válido, null", () => {
    expect(parseAssets(JSON.stringify(assets, null, 2))).toEqual(assets);
    expect(parseAssets("no es json")).toBeNull();
    expect(parseAssets('{"titulos": []}')).toBeNull();
    expect(parseAssets(null)).toBeNull();
    // Un JSON guardado antes de que existiera el ángulo sigue sirviendo.
    const thumb = {
      texto: "8 GB vs 16 GB",
      escena: "e",
      expresion: "x",
      protagonista: "p",
      composicion: "c",
      ayuda_visual: "a",
      emocion: "m",
      titulo: "t",
      texto_alternativo: "alt",
    };
    expect(
      parseAssets(JSON.stringify({ ...assets, miniaturas: [thumb] }))?.miniaturas[0]?.angulo,
    ).toBe("");
  });

  it("limpia las keywords: sin vacías ni repetidas, máximo 8", () => {
    expect(cleanKeywords(assets.keywords)).toEqual(["portátil nuevo", "mejor portátil 2026"]);
    expect(cleanKeywords(Array.from({ length: 10 }, (_, i) => `k${i}`))).toHaveLength(8);
  });

  it("guarda keywords y pilar solo si el episodio no los tiene; si no, los sugiere", () => {
    const empty = episodePatchFromAssets({ keywords: [], pillar_id: null }, assets, pillars);
    expect(empty.patch).toEqual({
      keywords: ["portátil nuevo", "mejor portátil 2026"],
      pillar_id: "p1",
    });
    expect(empty.suggestion).toEqual({ keywords: null, pillar: null });

    const full = episodePatchFromAssets({ keywords: ["otra"], pillar_id: "p2" }, assets, pillars);
    expect(full.patch).toEqual({});
    expect(full.suggestion).toEqual({
      keywords: ["portátil nuevo", "mejor portátil 2026"],
      pillar: { id: "p1", name: "Compras" },
    });

    // Lo mismo que ya tiene (sin importar mayúsculas ni acentos) no se sugiere.
    expect(
      assetsSuggestion(
        { keywords: ["Portatil nuevo", "mejor portátil 2026"], pillar_id: "p1" },
        assets,
        pillars,
      ),
    ).toEqual({ keywords: null, pillar: null });
    // Un pilar que no existe en el canal no se guarda.
    expect(
      episodePatchFromAssets(
        { keywords: [], pillar_id: null },
        { ...assets, pilar: "Otro" },
        pillars,
      ).patch,
    ).toEqual({ keywords: ["portátil nuevo", "mejor portátil 2026"] });
  });
});
