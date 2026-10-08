import { SCRIPT_STEPS, type ScriptStep } from "@planificador/ai";

/**
 * Qué depende de qué en un episodio, para los botones «Rehacer» y «Borrar»:
 * si algo ya generado depende de una tarjeta, rehacerla queda bloqueado y se
 * dice qué lo bloquea. Para desbloquear se borra lo que depende (de abajo
 * hacia arriba: renders → plan → guion; miniaturas → textos → guion).
 */

/** Lo que ya existe del episodio (lo arma `loadEpisodeDependents`). */
export type EpisodeDependents = {
  /** Hay una corrida del guion. */
  script: boolean;
  /** El podcast está generado en la corrida vigente. */
  podcast: boolean;
  /** Hay ayudas visuales en el plan (de cualquier estado). */
  plan: boolean;
  /** Códigos de las ayudas con renders (M1, C2…). */
  renders: string[];
  /** Hay textos (ideas) de miniaturas. */
  ideas: boolean;
  /** Letras de los diseños con miniaturas generadas (A, B, C). */
  thumbnails: string[];
};

export const NO_DEPENDENTS: EpisodeDependents = {
  script: false,
  podcast: false,
  plan: false,
  renders: [],
  ideas: false,
  thumbnails: [],
};

export type BlockerKind = "script" | "podcast" | "plan" | "renders" | "ideas" | "thumbnails";
export type Blocker = { kind: BlockerKind; detail: string | null; href: string };

const HREF: Record<BlockerKind, string> = {
  script: "?tab=script",
  podcast: "?tab=script",
  plan: "?tab=production&sub=aids",
  renders: "?tab=production&sub=aids",
  ideas: "?tab=production&sub=thumbnails",
  thumbnails: "?tab=production&sub=thumbnails",
};

/** Lo que se rehace o se borra. */
export type Target =
  | { kind: "direction" }
  | { kind: "step"; step: ScriptStep }
  | { kind: "plan" }
  | { kind: "ideas" }
  | { kind: "deleteScript" }
  | { kind: "deletePlan" }
  | { kind: "deleteIdeas" };

const blocker = (kind: BlockerKind, detail: string | null = null): Blocker => ({
  kind,
  detail,
  href: HREF[kind],
});

/** El plan de ayudas sale del guion verificado y de las fichas de motion. */
const PLAN_FROM = SCRIPT_STEPS.indexOf("motion");

/** Lo generado que depende de `target` y no deja rehacerlo (ni borrarlo). */
export function blockersFor(target: Target, deps: EpisodeDependents): Blocker[] {
  const out: Blocker[] = [];
  const plan = () => deps.plan && out.push(blocker("plan"));
  const renders = () =>
    deps.renders.length && out.push(blocker("renders", deps.renders.join(", ")));
  const ideas = () => deps.ideas && out.push(blocker("ideas"));
  const thumbnails = () =>
    deps.thumbnails.length && out.push(blocker("thumbnails", deps.thumbnails.join(", ")));
  switch (target.kind) {
    case "direction":
      if (deps.script) out.push(blocker("script"));
      break;
    case "step": {
      // El podcast es lo último: de él no depende nada.
      if (target.step.startsWith("podcast")) break;
      if (SCRIPT_STEPS.indexOf(target.step) <= PLAN_FROM) plan();
      // Los textos y las miniaturas salen de la ficha de publicación (assets_json).
      ideas();
      thumbnails();
      // Una corrida nueva del guion no trae el podcast: hay que volver a generarlo.
      if (deps.podcast) out.push(blocker("podcast"));
      break;
    }
    case "deleteScript":
      plan();
      ideas();
      thumbnails();
      break;
    case "plan":
    case "deletePlan":
      renders();
      break;
    case "ideas":
    case "deleteIdeas":
      thumbnails();
      break;
  }
  return out;
}
