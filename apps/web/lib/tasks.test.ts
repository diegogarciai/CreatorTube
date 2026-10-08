import { describe, expect, it } from "vitest";
import { mergeTask, mergeTasks, type TaskRow } from "./tasks";

const row = (patch: Partial<TaskRow>): TaskRow => ({
  id: "t1",
  kind: "ping",
  status: "running",
  progress: 0,
  message: null,
  error: null,
  created_at: "2026-10-08T02:00:00Z",
  finished_at: null,
  ...patch,
});

describe("bandeja de tareas: eventos en desorden", () => {
  it("lo terminado no vuelve a correr", () => {
    const done = row({ status: "succeeded", progress: 1, finished_at: "2026-10-08T02:00:09Z" });
    const late = row({ status: "running", progress: 1, message: "Paso 5 de 5" });
    expect(mergeTask(done, late)).toBe(done);
    const failed = row({ status: "failed", error: "x" });
    expect(mergeTask(failed, row({ progress: 0.4 }))).toBe(failed);
  });

  it("el avance no baja, pero sí avanza", () => {
    const ahead = row({ progress: 0.6 });
    expect(mergeTask(ahead, row({ progress: 0.4 }))).toBe(ahead);
    const next = row({ progress: 0.8 });
    expect(mergeTask(ahead, next)).toBe(next);
  });

  it("de la cola pasa a correr y de correr a terminar", () => {
    const running = row({ status: "running" });
    expect(mergeTask(row({ status: "queued" }), running)).toBe(running);
    expect(mergeTask(running, row({ status: "queued" }))).toBe(running);
    const failed = row({ status: "failed" });
    expect(mergeTask(running, failed)).toBe(failed);
  });

  it("mezcla listas: las más recientes primero y con tope", () => {
    const a = row({ id: "a", created_at: "2026-10-08T01:00:00Z" });
    const b = row({ id: "b", created_at: "2026-10-08T03:00:00Z" });
    const aDone = row({ id: "a", status: "succeeded", created_at: a.created_at });
    const merged = mergeTasks([a], [b, aDone]);
    expect(merged.map((r) => [r.id, r.status])).toEqual([
      ["b", "running"],
      ["a", "succeeded"],
    ]);
    expect(mergeTasks(merged, [row({ id: "c" })], 2)).toHaveLength(2);
  });
});
