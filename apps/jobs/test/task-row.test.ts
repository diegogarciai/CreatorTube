import { describe, expect, it } from "vitest";
import { markFailed, runTracked } from "../src/lib/task-row";
import type { ServiceClient } from "../src/lib/supabase";

/** Cliente falso que guarda cada `update` de la fila. */
function fakeClient() {
  const patches: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          patches.push(patch);
          return { error: null };
        },
      }),
    }),
  } as unknown as ServiceClient;
  return { client, patches };
}

describe("fila de la tarea", () => {
  it("marca en curso, avance y terminada", async () => {
    const { client, patches } = fakeClient();
    const out = await runTracked(
      "t1",
      async (report) => {
        await report.progress(0.5, "Mitad");
        await report.progress(7);
        return 42;
      },
      client,
    );
    expect(out).toBe(42);
    expect(patches[0]).toMatchObject({ status: "running", error: null });
    expect(patches[1]).toEqual({ progress: 0.5, message: "Mitad" });
    expect(patches[2]).toEqual({ progress: 1 });
    expect(patches[3]).toMatchObject({ status: "succeeded", progress: 1 });
  });

  it("si falla deja el motivo y relanza para que Trigger.dev reintente", async () => {
    const { client, patches } = fakeClient();
    await expect(
      runTracked(
        "t2",
        async () => {
          throw new Error("API caída");
        },
        client,
      ),
    ).rejects.toThrow("API caída");
    expect(patches.at(-1)).toEqual({ message: "Reintentando: API caída" });
    await markFailed("t2", new Error("x".repeat(900)), client);
    const last = patches.at(-1) as { status: string; error: string };
    expect(last.status).toBe("failed");
    expect(last.error).toHaveLength(500);
  });
});
