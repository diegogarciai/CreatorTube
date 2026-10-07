import { describe, expect, it } from "vitest";
import {
  autoAdvanceFromYouTube,
  canChangeStatus,
  changeStatus,
  completeStage,
  EPISODE_STAGES,
  nextStep,
  statusDuringStage,
} from "../src";
import { ep } from "./fixtures";

describe("episodios", () => {
  it("cada etapa completa hacia una etapa coherente con su estado", () => {
    for (const stage of EPISODE_STAGES) {
      const e = ep({ stage, status: statusDuringStage(stage) });
      const next = completeStage(e);
      if (next && next.stage !== "publication") {
        expect(statusDuringStage(next.stage)).toBe(next.status);
      }
    }
  });

  it("el flujo completo recorre las etapas en orden", () => {
    let e = ep();
    const visited: string[] = [e.stage];
    for (let i = 0; i < 6; i++) {
      const next = completeStage(e)!;
      e = { ...e, ...next };
      visited.push(e.stage);
    }
    expect(visited).toEqual([
      "planning",
      "direction",
      "script",
      "verification",
      "preparation",
      "recording",
      "publication",
    ]);
    expect(e.status).toBe("editing");
    e = { ...e, ...completeStage(e)! };
    expect(e.status).toBe("scheduled");
    expect(completeStage(e)).toBeNull();
  });

  it("las acciones con IA no están disponibles en Fase 1 pero se pueden saltar", () => {
    const step = nextStep(ep({ stage: "script", status: "script" }), "2026-10-07");
    expect(step.action).toBe("generate_script");
    expect(step.available).toBe(false);
    expect(step.canSkip).toBe(true);
    const rec = nextStep(ep({ stage: "recording", status: "to_record" }), "2026-10-07");
    expect(rec).toMatchObject({ action: "mark_recorded", available: true });
  });

  it("la evaluación se habilita a los 7 días de publicar", () => {
    const e = ep({ stage: "evaluation", status: "published", publishedOn: "2026-10-01" });
    expect(nextStep(e, "2026-10-07").availableFrom).toBe("2026-10-08");
    expect(nextStep({ ...e, evaluatedAt: new Date() }, "2026-10-09").action).toBe("done");
  });

  it("cambiar de estado a mano ubica la etapa por defecto", () => {
    expect(changeStatus(ep(), "to_record")).toEqual({ stage: "preparation", status: "to_record" });
    const same = ep({ stage: "verification", status: "script" });
    expect(changeStatus(same, "script").stage).toBe("verification");
  });

  it("permisos de movimiento por rol", () => {
    expect(canChangeStatus("producer", "planned", "published")).toBe(true);
    expect(canChangeStatus("video_editor", "to_record", "editing")).toBe(true);
    expect(canChangeStatus("video_editor", "editing", "scheduled")).toBe(false);
    expect(canChangeStatus("writer", "planned", "script")).toBe(false);
    expect(canChangeStatus("viewer", "planned", "script")).toBe(false);
  });

  it("avanza solo leyendo YouTube y nunca retrocede", () => {
    const editing = ep({ status: "editing", stage: "publication" });
    expect(
      autoAdvanceFromYouTube(editing, {
        privacyStatus: "private",
        publishAt: new Date("2026-10-10T15:00:00Z"),
        publishedAt: null,
      }),
    ).toEqual({ stage: "publication", status: "scheduled" });
    expect(
      autoAdvanceFromYouTube(editing, {
        privacyStatus: "public",
        publishAt: null,
        publishedAt: new Date(),
      }),
    ).toEqual({ stage: "distribution", status: "published" });
    const published = ep({ status: "published", stage: "evaluation" });
    expect(
      autoAdvanceFromYouTube(published, {
        privacyStatus: "private",
        publishAt: new Date(),
        publishedAt: null,
      }),
    ).toBeNull();
  });
});
