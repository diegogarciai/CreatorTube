import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { can, PERMISSIONS, ROLES } from "@planificador/core";
import {
  addMember,
  as,
  createChannel,
  createEpisode,
  createUser,
  createWorkspace,
  pool,
  sql,
} from "./helpers";

afterAll(() => pool.end());

describe("matriz de permisos", () => {
  it("SQL y core coinciden", async () => {
    for (const role of ROLES) {
      for (const perm of PERMISSIONS) {
        const [row] = await sql("select public.role_has_permission($1, $2) as ok", [role, perm]);
        expect(row.ok, `${role}/${perm}`).toBe(can(role, perm));
      }
    }
  });
});

describe("registro por invitación", () => {
  const hook = async (email: string) =>
    (await sql("select public.hook_before_user_created($1) as r", [{ user: { email } }]))[0].r;

  it("rechaza correos sin invitación", async () => {
    expect((await hook("nadie@example.com")).error.http_code).toBe(403);
  });

  it("acepta invitados y administradores de plataforma", async () => {
    await sql("insert into public.platform_admins (email) values ('jefa@example.com')");
    expect(await hook("JEFA@example.com")).toEqual({});
    await sql(
      "insert into public.invitations (kind, email, token_hash) values ('platform', 'nuevo@example.com', public.hash_invitation_token('tok-nuevo'))",
    );
    expect(await hook("nuevo@example.com")).toEqual({});
  });

  it("no acepta invitaciones vencidas", async () => {
    await sql(
      "insert into public.invitations (kind, email, token_hash, expires_at) values ('platform', 'tarde@example.com', public.hash_invitation_token('tok-tarde'), now() - interval '1 day')",
    );
    expect((await hook("tarde@example.com")).error).toBeDefined();
  });

  it("solo supabase_auth_admin ejecuta el hook", async () => {
    const u = await createUser();
    await expect(
      as(u.id, (q) => q("select public.hook_before_user_created('{}')")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("invitaciones", () => {
  it("invitación de plataforma: crea el espacio y deja como propietaria", async () => {
    const admin = await createUser("admin");
    await sql("insert into public.platform_admins (email) values ($1)", [admin.email]);
    const guest = await createUser("guest");

    await as(admin.id, (q) =>
      q(
        "insert into public.invitations (kind, email, token_hash, invited_by) values ('platform', $1, public.hash_invitation_token('tok-a'), $2)",
        [guest.email, admin.id],
      ),
    );
    const [preview] = await as(null, (q) => q("select * from public.invitation_preview('tok-a')"));
    expect(preview).toMatchObject({ kind: "platform", expired: false, accepted: false });
    expect(preview.email_hint).toMatch(/\*\*\*@example\.com$/);

    const ws = await as(
      guest.id,
      async (q) => (await q("select public.accept_invitation('tok-a', 'Mi agencia') as ws"))[0].ws,
    );
    const [m] = await sql(
      "select role from public.memberships where workspace_id = $1 and user_id = $2",
      [ws, guest.id],
    );
    expect(m.role).toBe("owner");
    await expect(
      as(guest.id, (q) => q("select public.accept_invitation('tok-a')")),
    ).rejects.toThrow(/ya fue usada/);
  });

  it("no se acepta con otro correo", async () => {
    const intruder = await createUser();
    await sql(
      "insert into public.invitations (kind, email, token_hash) values ('platform', 'otra@example.com', public.hash_invitation_token('tok-b'))",
    );
    await expect(
      as(intruder.id, (q) => q("select public.accept_invitation('tok-b')")),
    ).rejects.toThrow(/otro correo/);
  });

  it("administradores invitan a su espacio; productores no; nadie invita propietarios", async () => {
    const owner = await createUser();
    const producer = await createUser();
    const ws = await createWorkspace(owner.id);
    await addMember(ws, producer.id, "producer");
    const insert = (uid: string, role: string, token: string) =>
      as(uid, (q) =>
        q(
          "insert into public.invitations (kind, workspace_id, email, role, token_hash, invited_by) values ('workspace', $1, 'x@example.com', $2, public.hash_invitation_token($3), $4)",
          [ws, role, token, uid],
        ),
      );
    await insert(owner.id, "video_editor", "tok-c");
    await expect(insert(producer.id, "viewer", "tok-d")).rejects.toThrow(/row-level security/);
    await expect(insert(owner.id, "owner", "tok-e")).rejects.toThrow();

    const editor = await createUser();
    await sql(
      "update public.invitations set email = $1 where token_hash = public.hash_invitation_token('tok-c')",
      [editor.email],
    );
    await as(editor.id, (q) => q("select public.accept_invitation('tok-c')"));
    const [m] = await sql(
      "select role from public.memberships where workspace_id = $1 and user_id = $2",
      [ws, editor.id],
    );
    expect(m.role).toBe("video_editor");
  });

  it("invitaciones pendientes: solo las propias y vigentes, y se aceptan sin el enlace", async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner.id, "Agencia");
    const guest = await createUser("pending");
    const other = await createUser();
    await sql(
      `insert into public.invitations (kind, workspace_id, email, role, token_hash, expires_at, accepted_at) values
        ('platform', null, $1, 'owner', public.hash_invitation_token('tok-p1'), now() + interval '1 day', null),
        ('workspace', $2, $1, 'writer', public.hash_invitation_token('tok-p2'), now() + interval '1 day', null),
        ('platform', null, $1, 'owner', public.hash_invitation_token('tok-p3'), now() - interval '1 day', null),
        ('platform', null, $1, 'owner', public.hash_invitation_token('tok-p4'), now() + interval '1 day', now()),
        ('platform', null, $3, 'owner', public.hash_invitation_token('tok-p5'), now() + interval '1 day', null)`,
      [guest.email, ws, other.email],
    );
    const pending = await as(guest.id, (q) => q("select * from public.my_pending_invitations()"));
    expect(pending.map((p) => [p.kind, p.workspace_name, p.role])).toEqual([
      ["platform", null, "owner"],
      ["workspace", "Agencia", "writer"],
    ]);
    await expect(
      as(null, (q) => q("select * from public.my_pending_invitations()")),
    ).rejects.toThrow(/permission denied/);

    const [platformInv, workspaceInv] = pending;
    await expect(
      as(other.id, (q) => q("select public.accept_invitation_by_id($1)", [platformInv.id])),
    ).rejects.toThrow(/otro correo/);
    const created = await as(
      guest.id,
      async (q) =>
        (await q("select public.accept_invitation_by_id($1, 'Mío') as ws", [platformInv.id]))[0].ws,
    );
    const joined = await as(
      guest.id,
      async (q) =>
        (await q("select public.accept_invitation_by_id($1) as ws", [workspaceInv.id]))[0].ws,
    );
    expect(joined).toBe(ws);
    const roles = await sql(
      "select w.name, m.role from public.memberships m join public.workspaces w on w.id = m.workspace_id where m.user_id = $1 order by w.name",
      [guest.id],
    );
    expect(roles).toEqual([
      { name: "Agencia", role: "writer" },
      { name: "Mío", role: "owner" },
    ]);
    expect(created).not.toBe(ws);
    await expect(
      as(guest.id, (q) => q("select public.accept_invitation_by_id($1)", [platformInv.id])),
    ).rejects.toThrow(/ya fue usada/);
    const [expired] = await sql(
      "select id from public.invitations where token_hash = public.hash_invitation_token('tok-p3')",
    );
    await expect(
      as(guest.id, (q) => q("select public.accept_invitation_by_id($1)", [expired.id])),
    ).rejects.toThrow(/venció/);
    await expect(
      as(guest.id, (q) => q("select public.accept_invitation_row($1, null)", [expired.id])),
    ).rejects.toThrow(/permission denied/);
    expect(await as(guest.id, (q) => q("select * from public.my_pending_invitations()"))).toEqual(
      [],
    );
  });

  it("solo un administrador de la plataforma crea espacios sin invitación", async () => {
    const admin = await createUser("boss");
    await sql("insert into public.platform_admins (email) values ($1)", [admin.email]);
    const nobody = await createUser();
    const ws = await as(
      admin.id,
      async (q) => (await q("select public.create_workspace('Gartechs') as ws"))[0].ws,
    );
    const [m] = await sql(
      "select role from public.memberships where workspace_id = $1 and user_id = $2",
      [ws, admin.id],
    );
    expect(m.role).toBe("owner");
    await expect(
      as(nobody.id, (q) => q("select public.create_workspace('Ajeno')")),
    ).rejects.toThrow(/Solo con invitación/);
  });
});

describe("aislamiento entre espacios", () => {
  let alice: { id: string }, bob: { id: string };
  let wsA: string, wsB: string, chA: string, chB: string, epB: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    wsA = await createWorkspace(alice.id, "A");
    wsB = await createWorkspace(bob.id, "B");
    chA = await createChannel(wsA, "Canal A", "CA");
    chB = await createChannel(wsB, "Canal B", "CB");
    epB = await createEpisode(chB, "Secreto de B");
  });

  it("no ve espacios, canales ni episodios ajenos", async () => {
    await as(alice.id, async (q) => {
      expect((await q("select id from public.workspaces")).map((r) => r.id)).toEqual([wsA]);
      expect((await q("select id from public.channels")).map((r) => r.id)).toEqual([chA]);
      expect(await q("select id from public.episodes where id = $1", [epB])).toEqual([]);
    });
  });

  it("no puede escribir en canales ajenos ni falsear el espacio", async () => {
    await expect(
      as(alice.id, (q) =>
        q("insert into public.episodes (channel_id, title) values ($1, 'x')", [chB]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(alice.id, (q) =>
        q("insert into public.episodes (channel_id, workspace_id, title) values ($1, $2, 'x')", [
          chB,
          wsA,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await as(alice.id, (q) =>
      q("update public.episodes set title = 'hackeado' where id = $1 returning id", [epB]),
    );
    expect(updated).toEqual([]);
  });

  it("el espacio de una fila siempre sale del canal", async () => {
    const [row] = await as(alice.id, (q) =>
      q(
        "insert into public.episodes (channel_id, workspace_id, title) values ($1, $1, 'ok') returning workspace_id",
        [chA],
      ),
    );
    expect(row.workspace_id).toBe(wsA);
  });

  it("crear un canal devuelve la fila (insert ... returning)", async () => {
    const rows = await as(alice.id, (q) =>
      q("insert into public.channels (workspace_id, name) values ($1, 'Nuevo') returning id", [
        wsA,
      ]),
    );
    expect(rows).toHaveLength(1);
    await expect(
      as(alice.id, (q) =>
        q("insert into public.channels (workspace_id, name) values ($1, 'Intruso')", [wsB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("los tokens de YouTube nunca llegan al cliente", async () => {
    await sql(
      "insert into public.channel_connections (channel_id, access_token_enc, refresh_token_enc, scopes) values ($1, 'cifrado', 'cifrado', '{youtube.readonly}')",
      [chA],
    );
    await as(alice.id, async (q) => {
      expect(await q("select * from public.channel_connections")).toEqual([]);
      const [info] = await q("select * from public.channel_connection_info($1)", [chA]);
      expect(info.status).toBe("active");
      expect(info).not.toHaveProperty("access_token_enc");
    });
    await as(bob.id, async (q) => {
      expect(await q("select * from public.channel_connection_info($1)", [chA])).toEqual([]);
    });
  });

  it("los visitantes sin sesión no leen nada", async () => {
    await expect(as(null, (q) => q("select * from public.episodes"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("la purga solo la ejecuta el servidor", async () => {
    await expect(as(alice.id, (q) => q("select public.purge_youtube_data()"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("roles dentro de un espacio", () => {
  let owner: { id: string }, editor: { id: string }, writer: { id: string }, viewer: { id: string };
  let ws: string, ch1: string, ch2: string, ep1: string;

  beforeAll(async () => {
    owner = await createUser();
    editor = await createUser();
    writer = await createUser();
    viewer = await createUser();
    ws = await createWorkspace(owner.id);
    ch1 = await createChannel(ws, "Uno");
    ch2 = await createChannel(ws, "Dos");
    await addMember(ws, editor.id, "video_editor", [ch1]);
    await addMember(ws, writer.id, "writer");
    await addMember(ws, viewer.id, "viewer");
    ep1 = await createEpisode(ch1, "Grabación", { status: "to_record", stage: "recording" });
  });

  it("un permiso limitado a un canal no ve los demás", async () => {
    const rows = await as(editor.id, (q) => q("select id from public.channels order by name"));
    expect(rows.map((r) => r.id)).toEqual([ch1]);
  });

  it("el editor de video pasa a En edición pero no cambia otra cosa", async () => {
    await as(editor.id, (q) =>
      q("update public.episodes set status = 'editing', stage = 'publication' where id = $1", [
        ep1,
      ]),
    );
    await expect(
      as(editor.id, (q) => q("update public.episodes set title = 'otro' where id = $1", [ep1])),
    ).rejects.toThrow(/solo puede cambiar el estado/);
    await expect(
      as(editor.id, (q) =>
        q("update public.episodes set status = 'published' where id = $1", [ep1]),
      ),
    ).rejects.toThrow(/no puede mover/);
  });

  it("el guionista crea ideas pero no episodios", async () => {
    await as(writer.id, (q) =>
      q("insert into public.ideas (channel_id, title) values ($1, 'Idea')", [ch2]),
    );
    await expect(
      as(writer.id, (q) =>
        q("insert into public.episodes (channel_id, title) values ($1, 'x')", [ch2]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("el lector no cambia nada", async () => {
    const rows = await as(viewer.id, (q) =>
      q("update public.episodes set title = 'x' where id = $1 returning id", [ep1]),
    );
    expect(rows).toEqual([]);
    await expect(
      as(viewer.id, (q) =>
        q("insert into public.ideas (channel_id, title) values ($1, 'x')", [ch1]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("solo quien configura regenera el enlace ICS", async () => {
    const [before] = await sql("select ics_token from public.channels where id = $1", [ch1]);
    const [r] = await as(owner.id, (q) => q("select public.regenerate_ics_token($1) as t", [ch1]));
    expect(r.t).not.toBe(before.ics_token);
    expect(r.t).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      as(viewer.id, (q) => q("select public.regenerate_ics_token($1)", [ch1])),
    ).rejects.toThrow(/Sin permiso/);
  });
});

describe("episodios y checklists", () => {
  let owner: { id: string }, ws: string, ch: string, other: string;

  beforeAll(async () => {
    owner = await createUser();
    ws = await createWorkspace(owner.id);
    ch = await createChannel(ws, "Gartechs", "GT");
    other = await createChannel(ws, "Otro", "OT");
  });

  it("número consecutivo por canal y código con prefijo", async () => {
    const rows = await as(owner.id, async (q) => [
      ...(await q(
        "insert into public.episodes (channel_id, title) values ($1, 'a') returning number, code",
        [ch],
      )),
      ...(await q(
        "insert into public.episodes (channel_id, title) values ($1, 'b') returning number, code",
        [ch],
      )),
      ...(await q(
        "insert into public.episodes (channel_id, title) values ($1, 'c') returning number, code",
        [other],
      )),
    ]);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 1]);
    expect(rows[0].code).toMatch(/^GT-\d{6}-\d{4}$/);
    expect(rows[2].code).toMatch(/^OT-/);
  });

  it("respeta el código de un episodio importado solo con el prefijo y el formato del canal", async () => {
    const rows = await as(owner.id, async (q) => [
      ...(await q(
        "insert into public.episodes (channel_id, title, code) values ($1, 'viejo', 'GT-240115-1830') returning code",
        [ch],
      )),
      ...(await q(
        "insert into public.episodes (channel_id, title, code) values ($1, 'ajeno', 'OT-240115-1830') returning code",
        [ch],
      )),
      ...(await q(
        "insert into public.episodes (channel_id, title, code) values ($1, 'raro', 'GT-hola') returning code",
        [ch],
      )),
    ]);
    expect(rows[0].code).toBe("GT-240115-1830");
    expect(rows[1].code).not.toBe("OT-240115-1830");
    expect(rows[1].code).toMatch(/^GT-\d{6}-\d{4}$/);
    expect(rows[2].code).toMatch(/^GT-\d{6}-\d{4}$/);
  });

  it("el número y el código no se pueden cambiar; el estado registra su fecha y actividad", async () => {
    const ep = await createEpisode(ch, "Inmutable");
    await sql(
      "update public.episodes set status_changed_at = now() - interval '10 days' where id = $1",
      [ep],
    );
    const [row] = await as(owner.id, (q) =>
      q(
        "update public.episodes set number = 999, code = 'X', status = 'script' where id = $1 returning number, code, status_changed_at",
        [ep],
      ),
    );
    expect(row.number).not.toBe(999);
    expect(row.code).not.toBe("X");
    expect(Date.now() - new Date(row.status_changed_at).getTime()).toBeLessThan(60_000);
    const log = await sql(
      "select action, details from public.activity_log where episode_id = $1 order by id",
      [ep],
    );
    expect(log.map((l) => l.action)).toEqual(["episode.created", "episode.status_changed"]);
    expect(log[1].details).toMatchObject({ from: "planned", to: "script" });
  });

  it("la marca de checklist es por identificador y del mismo canal", async () => {
    const [step] = await sql<{ id: string }>(
      "insert into public.checklist_steps (channel_id, label, phase) values ($1, 'Miniatura', 'before_publish') returning id",
      [ch],
    );
    const [foreign] = await sql<{ id: string }>(
      "insert into public.checklist_steps (channel_id, label, phase) values ($1, 'Ajeno', 'before_publish') returning id",
      [other],
    );
    const ep = await createEpisode(ch, "Con checklist");
    await as(owner.id, (q) =>
      q(
        "insert into public.episode_checklist_items (episode_id, step_id, done_by) values ($1, $2, $3)",
        [ep, step!.id, owner.id],
      ),
    );
    await sql("update public.checklist_steps set label = 'Miniatura final' where id = $1", [
      step!.id,
    ]);
    const items = await sql(
      "select step_id, channel_id from public.episode_checklist_items where episode_id = $1",
      [ep],
    );
    expect(items).toEqual([{ step_id: step!.id, channel_id: ch }]);
    await expect(
      as(owner.id, (q) =>
        q("insert into public.episode_checklist_items (episode_id, step_id) values ($1, $2)", [
          ep,
          foreign!.id,
        ]),
      ),
    ).rejects.toThrow(/no pertenece al canal/);
  });

  it("una fila no se muda de canal", async () => {
    const ep = await createEpisode(ch, "Fijo");
    await expect(
      as(owner.id, (q) =>
        q("update public.episodes set channel_id = $1 where id = $2", [other, ep]),
      ),
    ).rejects.toThrow(/otro canal/);
  });
});

describe("retención de datos de YouTube", () => {
  it("borra textos viejos y datos de canales desconectados", async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner.id);
    const live = await createChannel(ws, "Vivo");
    const gone = await createChannel(ws, "Desconectado");
    await sql(
      `insert into public.youtube_videos (channel_id, video_id, title, description, fetched_at) values
        ($1, 'aaaaaaaaaaa', 'viejo', 'desc', now() - interval '31 days'),
        ($1, 'bbbbbbbbbbb', 'nuevo', 'desc', now()),
        ($2, 'ccccccccccc', 'otro', 'desc', now())`,
      [live, gone],
    );
    await sql(
      "insert into public.youtube_channel_daily_stats (channel_id, day, views) values ($1, current_date, 10), ($2, current_date, 5)",
      [live, gone],
    );
    await sql(
      `insert into public.youtube_video_retention (channel_id, video_id, points) values ($1, 'ccccccccccc', '[{"r":0.5,"watch":0.4,"relative":0.5}]')`,
      [gone],
    );
    await sql("update public.channels set disconnected_at = now() where id = $1", [gone]);
    const [r] = await sql("select public.purge_youtube_data() as r");
    expect(
      await sql(
        "select channel_id from public.youtube_channel_daily_stats where channel_id = any($1)",
        [[live, gone]],
      ),
    ).toEqual([{ channel_id: live }]);
    expect(
      await sql("select video_id from public.youtube_video_retention where channel_id = $1", [
        gone,
      ]),
    ).toEqual([]);
    expect(r.r.disconnected_deleted).toBeGreaterThanOrEqual(1);
    const rows = await sql(
      "select video_id, title from public.youtube_videos where channel_id = any($1) order by video_id",
      [[live, gone]],
    );
    expect(rows).toEqual([
      { video_id: "aaaaaaaaaaa", title: null },
      { video_id: "bbbbbbbbbbb", title: "nuevo" },
    ]);
  });
});

describe("Fase 4 · analítica", () => {
  it("se lee con permiso del canal y la escribe solo el servidor", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    const [row] = await sql(
      "insert into public.youtube_channel_daily_stats (channel_id, day, views, average_view_percentage) values ($1, '2026-10-01', 120, 41.5) returning workspace_id",
      [ch],
    );
    expect(row.workspace_id).toBe(ws);
    await sql(
      `insert into public.youtube_video_retention (channel_id, video_id, points) values ($1, 'aaaaaaaaaaa', '[{"r":0.01,"watch":1,"relative":0.6}]')`,
      [ch],
    );
    await expect(
      sql(
        "insert into public.youtube_video_retention (channel_id, video_id, points) values ($1, 'b', '{}')",
        [ch],
      ),
    ).rejects.toThrow(/check constraint/);
    const read = (uid: string) =>
      as(uid, async (q) => ({
        days: await q(
          "select views from public.youtube_channel_daily_stats where channel_id = $1",
          [ch],
        ),
        retention: await q(
          "select video_id from public.youtube_video_retention where channel_id = $1",
          [ch],
        ),
      }));
    expect(await read(owner.id)).toEqual({
      days: [{ views: "120" }],
      retention: [{ video_id: "aaaaaaaaaaa" }],
    });
    expect(await read(outsider.id)).toEqual({ days: [], retention: [] });
    await expect(
      as(owner.id, (q) =>
        q(
          "insert into public.youtube_channel_daily_stats (channel_id, day) values ($1, '2026-10-02')",
          [ch],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("Fase 4 · fotos de contadores («Así te fue ayer»)", () => {
  it("la primera foto del día manda, se lee con permiso y la purga borra las viejas", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    const snap = (day: string, views: number) =>
      sql(
        "insert into public.youtube_video_snapshots (channel_id, video_id, day, view_count) values ($1, 'aaaaaaaaaaa', $2, $3) on conflict do nothing",
        [ch, day, views],
      );
    await snap("2026-10-07", 100);
    await snap("2026-10-07", 180);
    await sql(
      "insert into public.youtube_video_snapshots (channel_id, video_id, day, view_count) values ($1, 'aaaaaaaaaaa', current_date - 40, 5)",
      [ch],
    );
    const read = (uid: string) =>
      as(uid, (q) =>
        q(
          "select view_count from public.youtube_video_snapshots where channel_id = $1 and day = '2026-10-07'",
          [ch],
        ),
      );
    expect(await read(owner.id)).toEqual([{ view_count: "100" }]);
    expect(await read(outsider.id)).toEqual([]);
    await expect(
      as(owner.id, (q) =>
        q(
          "insert into public.youtube_video_snapshots (channel_id, video_id, day) values ($1, 'b', '2026-10-08')",
          [ch],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const [r] = await sql("select public.purge_youtube_data() as r");
    expect(r.r.old_snapshots_deleted).toBeGreaterThanOrEqual(1);
    expect(
      await sql("select day::text from public.youtube_video_snapshots where channel_id = $1", [ch]),
    ).toEqual([{ day: "2026-10-07" }]);
  });
});

describe("Fase 4 · alcance (impresiones, CTR y fuentes)", () => {
  it("se lee con permiso del canal, la escribe el servidor y se purga al desconectar", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    const [row] = await sql(
      "insert into public.youtube_video_reach_daily (channel_id, video_id, day, impressions, ctr) values ($1, 'aaaaaaaaaaa', '2026-10-05', 1000, 0.054) returning workspace_id",
      [ch],
    );
    expect(row.workspace_id).toBe(ws);
    await sql(
      "insert into public.youtube_video_reach_sources (channel_id, video_id, day, traffic_source, impressions, clicks) values ($1, 'aaaaaaaaaaa', '2026-10-05', '5', 800, 50)",
      [ch],
    );
    await expect(
      sql(
        "insert into public.youtube_video_reach_daily (channel_id, video_id, day, ctr) values ($1, 'b', '2026-10-05', 5.4)",
        [ch],
      ),
    ).rejects.toThrow(/check constraint/);
    const read = (uid: string) =>
      as(uid, async (q) => ({
        reach: await q(
          "select impressions from public.youtube_video_reach_daily where channel_id = $1",
          [ch],
        ),
        sources: await q(
          "select traffic_source from public.youtube_video_reach_sources where channel_id = $1",
          [ch],
        ),
      }));
    expect(await read(owner.id)).toEqual({
      reach: [{ impressions: "1000" }],
      sources: [{ traffic_source: "5" }],
    });
    expect(await read(outsider.id)).toEqual({ reach: [], sources: [] });
    // Las sumas respetan las políticas: el ajeno no ve nada.
    const sums = (uid: string) =>
      as(uid, async (q) => ({
        day: await q(
          "select day::text, impressions, clicks from public.reach_by_day($1, '2026-10-01')",
          [ch],
        ),
        source: await q(
          "select traffic_source, impressions from public.reach_by_source($1, '2026-10-01', '2026-10-31', 'aaaaaaaaaaa')",
          [ch],
        ),
      }));
    expect(await sums(owner.id)).toEqual({
      day: [{ day: "2026-10-05", impressions: "1000", clicks: "54.000" }],
      source: [{ traffic_source: "5", impressions: "800" }],
    });
    expect(await sums(outsider.id)).toEqual({ day: [], source: [] });
    await expect(
      as(owner.id, (q) =>
        q(
          "insert into public.youtube_video_reach_daily (channel_id, video_id, day) values ($1, 'c', '2026-10-06')",
          [ch],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await sql("update public.channels set disconnected_at = now() where id = $1", [ch]);
    await sql("select public.purge_youtube_data()");
    expect(
      await sql(
        "select (select count(*) from public.youtube_video_reach_daily where channel_id = $1) + (select count(*) from public.youtube_video_reach_sources where channel_id = $1) as n",
        [ch],
      ),
    ).toEqual([{ n: "0" }]);
  });
});

describe("Fase 4 · comentarios", () => {
  it("se leen con permiso, los escribe el servidor y se purgan a los 30 días", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    const ep = await createEpisode(ch, "Con comentarios");
    const add = (id: string, fetched = "now()") =>
      sql(
        `insert into public.youtube_comments (channel_id, comment_id, episode_id, video_id, text, published_at, kind, fetched_at)
         values ($1, $2, $3, 'vid', 'Hola', now(), 'elogio', ${fetched}) returning workspace_id`,
        [ch, id, ep],
      );
    const [row] = await add("c1");
    expect(row.workspace_id).toBe(ws);
    await add("c2", "now() - interval '31 days'");
    await expect(
      sql(
        "insert into public.youtube_comments (channel_id, comment_id, video_id, published_at, kind) values ($1, 'x', 'vid', now(), 'otro')",
        [ch],
      ),
    ).rejects.toThrow(/check constraint/);
    await sql(
      `insert into public.comment_readings (episode_id, channel_id, reading, comments) values ($1, $2, '{"pains":[]}', 2)`,
      [ep, ch],
    );
    const read = (uid: string) =>
      as(uid, async (q) => ({
        comments: await q(
          "select comment_id from public.youtube_comments where channel_id = $1 order by comment_id",
          [ch],
        ),
        readings: await q("select comments from public.comment_readings where channel_id = $1", [
          ch,
        ]),
      }));
    expect(await read(owner.id)).toEqual({
      comments: [{ comment_id: "c1" }, { comment_id: "c2" }],
      readings: [{ comments: 2 }],
    });
    expect(await read(outsider.id)).toEqual({ comments: [], readings: [] });
    await expect(
      as(owner.id, (q) =>
        q("update public.youtube_comments set reply = 'x' where channel_id = $1 returning 1", [ch]),
      ),
    ).resolves.toEqual([]);
    const [r] = await sql("select public.purge_youtube_data() as r");
    expect(r.r.old_comments_deleted).toBeGreaterThanOrEqual(1);
    expect(
      await sql("select comment_id from public.youtube_comments where channel_id = $1", [ch]),
    ).toEqual([{ comment_id: "c1" }]);
    await sql("update public.channels set disconnected_at = now() where id = $1", [ch]);
    await sql("select public.purge_youtube_data()");
    expect(
      await sql(
        "select (select count(*) from public.youtube_comments where channel_id = $1) + (select count(*) from public.comment_readings where channel_id = $1) as n",
        [ch],
      ),
    ).toEqual([{ n: "0" }]);
  });
});

describe("Fase 2 · guía del guionista y créditos", () => {
  const sections = JSON.stringify([{ key: "0", title: "PRIORIDADES", body: "Verdad." }]);
  const stages = JSON.stringify({ study: ["0"] });
  const publish = (uid: string, ch: string, content: string) =>
    as(
      uid,
      async (q) =>
        (
          await q(
            "select public.publish_writer_guide_version($1, $2, 'nota', $3::jsonb, $4::jsonb) as id",
            [ch, content, sections, stages],
          )
        )[0].id as string,
    );

  it("publica versiones consecutivas; solo quien configura; no se editan", async () => {
    const owner = await createUser();
    const writer = await createUser();
    const ws = await createWorkspace(owner.id);
    const ch = await createChannel(ws);
    await addMember(ws, writer.id, "writer");

    const v1 = await publish(owner.id, ch, "0. PRIORIDADES\nVerdad.");
    const v2 = await publish(owner.id, ch, "0. PRIORIDADES\nVerdad y claridad.");
    const versions = await as(writer.id, (q) =>
      q(
        "select id, version, sections, created_by from public.writer_guide_versions where channel_id = $1 order by version",
        [ch],
      ),
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0].sections[0].title).toBe("PRIORIDADES");
    expect(versions[0].created_by).toBe(owner.id);
    const [guide] = await sql(
      "select current_version_id from public.writer_guides where channel_id = $1",
      [ch],
    );
    expect(guide.current_version_id).toBe(v2);

    await expect(publish(writer.id, ch, "x")).rejects.toThrow(/no permite/);
    await expect(
      as(owner.id, (q) =>
        q(
          "insert into public.writer_guide_versions (channel_id, guide_id, version, content) select $1, guide_id, 9, 'x' from public.writer_guide_versions where id = $2",
          [ch, v1],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await as(owner.id, (q) =>
      q("update public.writer_guide_versions set content = 'cambiado' where id = $1 returning id", [
        v1,
      ]),
    );
    expect(updated).toEqual([]);
    await expect(
      as(owner.id, (q) =>
        q("select public.publish_writer_guide_version($1, 'x', null, '[]'::jsonb, '{}'::jsonb)", [
          ch,
        ]),
      ),
    ).rejects.toThrow(/no tiene secciones/);
  });

  it("ficha de entrada en el episodio", async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner.id);
    const ch = await createChannel(ws);
    const ep = await createEpisode(ch);
    const [row] = await as(owner.id, (q) =>
      q(
        "update public.episodes set episode_type = 'product', target_minutes = 12, sponsorship = 'none', own_measurements = 'Medí 3 horas', stance_confirmed = true where id = $1 returning episode_type, target_minutes, sponsorship, stance_confirmed",
        [ep],
      ),
    );
    expect(row).toEqual({
      episode_type: "product",
      target_minutes: 12,
      sponsorship: "none",
      stance_confirmed: true,
    });
    await expect(
      as(owner.id, (q) => q("update public.episodes set target_minutes = 90 where id = $1", [ep])),
    ).rejects.toThrow(/check/);
  });

  it("créditos: cupo por espacio, consumo del mes y solo la plataforma cambia el cupo", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await sql(
      `insert into public.usage_ledger (workspace_id, kind, credits, cost_usd, created_at) values
        ($1, 'script', 120.5, 1.205, now()),
        ($1, 'script', 999, 9.99, now() - interval '40 days')`,
      [ws],
    );
    const [bal] = await as(owner.id, (q) => q("select * from public.workspace_credits($1)", [ws]));
    expect(Number(bal.monthly)).toBe(2000);
    expect(Number(bal.used)).toBe(120.5);
    expect(Number(bal.remaining)).toBe(1879.5);
    expect(
      await as(outsider.id, (q) => q("select * from public.workspace_credits($1)", [ws])),
    ).toEqual([]);

    await expect(
      as(owner.id, (q) =>
        q("update public.workspaces set monthly_credits = 999999 where id = $1", [ws]),
      ),
    ).rejects.toThrow(/Solo la administración/);
    await as(owner.id, (q) =>
      q("update public.workspaces set name = 'Renombrado' where id = $1", [ws]),
    );
    // El cupo lo cambia el servidor (service role) tras verificar que es administración.
    await sql("update public.workspaces set monthly_credits = 3000 where id = $1", [ws]);
    const [w] = await sql("select name, monthly_credits from public.workspaces where id = $1", [
      ws,
    ]);
    expect(w).toEqual({ name: "Renombrado", monthly_credits: 3000 });
  });
});

describe("Fase 2 · dirección del episodio", () => {
  it("la escribe el servidor, la responde quien escribe guiones y nadie la cuelga de otro canal", async () => {
    const owner = await createUser();
    const writer = await createUser();
    const viewer = await createUser();
    const ws = await createWorkspace(owner.id);
    const ch = await createChannel(ws);
    const other = await createChannel(ws, "Otro");
    await addMember(ws, writer.id, "writer");
    await addMember(ws, viewer.id, "viewer");
    const ep = await createEpisode(ch);

    // Los clientes no crean filas: las prepara el motor de tareas.
    await expect(
      as(owner.id, (q) =>
        q("insert into public.episode_direction (episode_id, channel_id) values ($1, $2)", [
          ep,
          ch,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      sql("insert into public.episode_direction (episode_id, channel_id) values ($1, $2)", [
        ep,
        other,
      ]),
    ).rejects.toThrow(/no es de ese canal/);
    await sql(
      `insert into public.episode_direction (episode_id, channel_id, status, questions) values ($1, $2, 'ready', '[{"id":"q1"}]')`,
      [ep, ch],
    );
    const [row] = await sql(
      "select workspace_id from public.episode_direction where episode_id = $1",
      [ep],
    );
    expect(row.workspace_id).toBe(ws);

    const answered = await as(writer.id, (q) =>
      q(
        `update public.episode_direction set status = 'answered', answers = '{"q1":{"selected":["A"],"text":""}}' where episode_id = $1 returning status`,
        [ep],
      ),
    );
    expect(answered).toEqual([{ status: "answered" }]);
    expect(
      await as(viewer.id, (q) =>
        q("update public.episode_direction set extra = 'x' where episode_id = $1 returning 1", [
          ep,
        ]),
      ),
    ).toEqual([]);
    expect(
      (
        await as(viewer.id, (q) =>
          q("select status from public.episode_direction where episode_id = $1", [ep]),
        )
      )[0].status,
    ).toBe("answered");
  });
});

describe("Fase 2 · guion en etapas", () => {
  it("lo escribe el servidor y lo lee quien ve el canal", async () => {
    const owner = await createUser();
    const writer = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    await addMember(ws, writer.id, "writer");
    const ep = await createEpisode(ch);

    await expect(
      as(writer.id, (q) =>
        q("insert into public.script_runs (channel_id, episode_id) values ($1, $2)", [ch, ep]),
      ),
    ).rejects.toThrow(/row-level security/);

    const [run] = await sql(
      "insert into public.script_runs (channel_id, episode_id) values ($1, $2) returning id, workspace_id, status",
      [ch, ep],
    );
    expect(run.workspace_id).toBe(ws);
    expect(run.status).toBe("queued");
    await sql(
      `insert into public.script_stage_runs (run_id, channel_id, stage, status, blocks) values ($1, $2, 'study', 'succeeded', '[{"title":"DOSSIER DE ESTUDIO","body":"x"}]')`,
      [run.id, ch],
    );
    await expect(
      sql(
        "insert into public.script_stage_runs (run_id, channel_id, stage) values ($1, $2, 'study')",
        [run.id, ch],
      ),
    ).rejects.toThrow(/duplicate key/);
    await sql("update public.episodes set current_script_run_id = $1 where id = $2", [run.id, ep]);

    const seen = await as(writer.id, (q) =>
      q(
        "select stage, blocks->0->>'title' as title from public.script_stage_runs where run_id = $1",
        [run.id],
      ),
    );
    expect(seen).toEqual([{ stage: "study", title: "DOSSIER DE ESTUDIO" }]);
    expect(
      await as(writer.id, (q) =>
        q("update public.script_runs set status = 'succeeded' where id = $1 returning 1", [run.id]),
      ),
    ).toEqual([]);
    expect(
      await as(writer.id, (q) =>
        q("update public.script_stage_runs set raw = 'x' where run_id = $1 returning 1", [run.id]),
      ),
    ).toEqual([]);
    expect(
      await as(outsider.id, (q) => q("select id from public.script_runs where id = $1", [run.id])),
    ).toEqual([]);
    expect(
      await as(outsider.id, (q) =>
        q("select id from public.script_stage_runs where run_id = $1", [run.id]),
      ),
    ).toEqual([]);

    // Pasos: uno por bloque, únicos por corrida, solo lectura para el equipo.
    const [stepRow] = await sql(
      "insert into public.script_step_runs (run_id, channel_id, stage, step, status, body) values ($1, $2, 'script', 'outline', 'succeeded', 'Escaleta') returning workspace_id",
      [run.id, ch],
    );
    expect(stepRow.workspace_id).toBe(ws);
    // La corrección sin fallas queda «Sin cambios».
    await sql(
      "insert into public.script_step_runs (run_id, channel_id, stage, step, status) values ($1, $2, 'script', 'revision', 'skipped')",
      [run.id, ch],
    );
    await expect(
      sql(
        "insert into public.script_step_runs (run_id, channel_id, stage, step) values ($1, $2, 'script', 'outline')",
        [run.id, ch],
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      as(writer.id, (q) =>
        q(
          "insert into public.script_step_runs (run_id, channel_id, stage, step) values ($1, $2, 'script', 'reels')",
          [run.id, ch],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await as(writer.id, (q) =>
        q("select step, body from public.script_step_runs where run_id = $1 order by step", [
          run.id,
        ]),
      ),
    ).toEqual([
      { step: "outline", body: "Escaleta" },
      { step: "revision", body: "" },
    ]);
    expect(
      await as(writer.id, (q) =>
        q("update public.script_step_runs set body = 'x' where run_id = $1 returning 1", [run.id]),
      ),
    ).toEqual([]);
    expect(
      await as(outsider.id, (q) =>
        q("select id from public.script_step_runs where run_id = $1", [run.id]),
      ),
    ).toEqual([]);

    // Verificación: una fila por afirmación, solo lectura para el equipo.
    await sql("update public.script_runs set status = 'paused' where id = $1", [run.id]);
    const [item] = await sql(
      "insert into public.verification_items (run_id, channel_id, idx, kind, claim, status, url, quote) values ($1, $2, 1, 'fact', '22 horas de batería', 'verified', 'https://apple.com', 'hasta 22 horas') returning workspace_id",
      [run.id, ch],
    );
    expect(item.workspace_id).toBe(ws);
    await expect(
      sql(
        "insert into public.verification_items (run_id, channel_id, idx, kind, claim) values ($1, $2, 1, 'fact', 'otra')",
        [run.id, ch],
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      sql(
        "insert into public.verification_items (run_id, channel_id, idx, kind, claim, status) values ($1, $2, 2, 'fact', 'x', 'inventado')",
        [run.id, ch],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(writer.id, (q) =>
        q(
          "insert into public.verification_items (run_id, channel_id, idx, kind, claim) values ($1, $2, 3, 'fact', 'x')",
          [run.id, ch],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await as(writer.id, (q) =>
        q("select claim, status from public.verification_items where run_id = $1", [run.id]),
      ),
    ).toEqual([{ claim: "22 horas de batería", status: "verified" }]);
    expect(
      await as(writer.id, (q) =>
        q("update public.verification_items set status = 'pending' where run_id = $1 returning 1", [
          run.id,
        ]),
      ),
    ).toEqual([]);
    expect(
      await as(outsider.id, (q) =>
        q("select id from public.verification_items where run_id = $1", [run.id]),
      ),
    ).toEqual([]);

    // Decisiones del presentador (10.4): las escribe el servidor; «value» pide el dato.
    await expect(
      sql("update public.verification_items set decision = 'value' where run_id = $1", [run.id]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      sql("update public.verification_items set decision = 'otra' where run_id = $1", [run.id]),
    ).rejects.toThrow(/check constraint/);
    await sql(
      "update public.verification_items set decision = 'value', decision_value = '1.099 dólares', decided_by = $2 where run_id = $1",
      [run.id, writer.id],
    );
    expect(
      await as(writer.id, (q) =>
        q("select decision, decision_value from public.verification_items where run_id = $1", [
          run.id,
        ]),
      ),
    ).toEqual([{ decision: "value", decision_value: "1.099 dólares" }]);
    expect(
      await as(writer.id, (q) =>
        q(
          "update public.verification_items set decision = 'remove' where run_id = $1 returning 1",
          [run.id],
        ),
      ),
    ).toEqual([]);
  });
});

describe("Fase 2 · importación desde YouTube", () => {
  it("los items los escribe el servidor y los lee quien ve el canal", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    const ep = await createEpisode(ch);
    const [task] = await sql(
      "insert into public.tasks (workspace_id, channel_id, kind) values ($1, $2, 'youtube_import') returning id",
      [ws, ch],
    );
    const [item] = await sql(
      "insert into public.youtube_import_items (task_id, channel_id, episode_id, video_id) values ($1, $2, $3, 'aaaaaaaaaaa') returning workspace_id, status",
      [task.id, ch, ep],
    );
    expect(item).toEqual({ workspace_id: ws, status: "pending" });
    await expect(
      sql("update public.youtube_import_items set status = 'inventado' where task_id = $1", [
        task.id,
      ]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(owner.id, (q) =>
        q(
          "insert into public.youtube_import_items (task_id, channel_id, episode_id, video_id) values ($1, $2, $3, 'bbbbbbbbbbb')",
          [task.id, ch, ep],
        ),
      ),
    ).rejects.toThrow(/row-level security|duplicate key/);
    expect(
      await as(owner.id, (q) =>
        q("select video_id from public.youtube_import_items where task_id = $1", [task.id]),
      ),
    ).toEqual([{ video_id: "aaaaaaaaaaa" }]);
    expect(
      await as(owner.id, (q) =>
        q("update public.youtube_import_items set status = 'done' where task_id = $1 returning 1", [
          task.id,
        ]),
      ),
    ).toEqual([]);
    expect(
      await as(outsider.id, (q) =>
        q("select video_id from public.youtube_import_items where task_id = $1", [task.id]),
      ),
    ).toEqual([]);
  });
});

describe("Fase 2 · modelos de IA", () => {
  it("el catálogo y los ajustes por espacio solo los toca el servidor", async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner.id);
    await sql(
      "insert into public.ai_models (id, display_name, input_price_usd, output_price_usd) values ('modelo-a', 'Modelo A', 3, 15)",
    );
    await sql(
      `insert into public.workspace_ai_settings (workspace_id, default_model, stage_models) values ($1, 'modelo-a', '{"script":"modelo-a"}')`,
      [ws],
    );
    await expect(
      sql(
        "insert into public.workspace_ai_settings (workspace_id, default_model) values ($1, 'inventado')",
        [await createWorkspace(owner.id, "Otro")],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      sql("update public.ai_models set input_price_usd = -1 where id = 'modelo-a'"),
    ).rejects.toThrow(/check constraint/);
    expect(await as(owner.id, (q) => q("select id from public.ai_models"))).toEqual([]);
    expect(
      await as(owner.id, (q) => q("select workspace_id from public.workspace_ai_settings")),
    ).toEqual([]);
    await expect(
      as(owner.id, (q) => q("insert into public.ai_models (id) values ('modelo-b')")),
    ).rejects.toThrow(/row-level security/);
    expect(
      await as(owner.id, (q) =>
        q(
          "update public.workspace_ai_settings set default_model = null where workspace_id = $1 returning 1",
          [ws],
        ),
      ),
    ).toEqual([]);
    // Si un modelo sale del catálogo, el espacio vuelve al de la plataforma.
    await sql("delete from public.ai_models where id = 'modelo-a'");
    const [row] = await sql(
      "select default_model from public.workspace_ai_settings where workspace_id = $1",
      [ws],
    );
    expect(row.default_model).toBeNull();
  });
});

describe("Fase 2 · panel de consumo", () => {
  it("el desglose y los presupuestos solo los usa el servidor", async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner.id);
    await sql(
      `insert into public.usage_ledger (workspace_id, kind, credits, cost_usd, meta) values
        ($1, 'script_outline', 30, 0.3, '{"model":"modelo-a","input_tokens":1000,"output_tokens":200,"ai_usd":0.3}'),
        ($1, 'script_verify', 10, 0.1, '{"model":"modelo-a","searches":4,"search_usd":0.02}'),
        ($1, 'script_verify', 5, 0.05, '{"model":"modelo-a","searches":2}')`,
      [ws],
    );
    const rows = await sql(
      "select kind, calls, cost_usd, searches, search_usd, legacy_searches from public.usage_breakdown(now() - interval '1 day', now() + interval '1 day') where workspace_id = $1 order by kind",
      [ws],
    );
    expect(
      rows.map((r) => [
        r.kind,
        Number(r.calls),
        Number(r.cost_usd),
        Number(r.searches),
        Number(r.search_usd),
        Number(r.legacy_searches),
      ]),
    ).toEqual([
      ["script_outline", 1, 0.3, 0, 0, 0],
      ["script_verify", 2, 0.15, 6, 0.02, 2],
    ]);
    const [month] = await sql("select calls from public.usage_monthly(1)");
    expect(Number(month.calls)).toBeGreaterThanOrEqual(3);

    await expect(
      as(owner.id, (q) =>
        q("select * from public.usage_breakdown(now() - interval '1 day', now())"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(as(owner.id, (q) => q("select * from public.usage_monthly(6)"))).rejects.toThrow(
      /permission denied/,
    );
    await sql("insert into public.service_budgets (service, monthly_usd) values ('ai', 50)");
    await expect(
      sql("insert into public.service_budgets (service, monthly_usd) values ('otro', 5)"),
    ).rejects.toThrow(/check constraint/);
    expect(await as(owner.id, (q) => q("select service from public.service_budgets"))).toEqual([]);
    await expect(
      as(owner.id, (q) =>
        q("insert into public.service_budgets (service, monthly_usd) values ('parallel', 1)"),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("Fase 3 · kit de marca y fotos del presentador", () => {
  it("el bucket del canal: lee quien lo ve y sube quien lo configura", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    await addMember(ws, viewer.id, "viewer");
    const ch = await createChannel(ws);
    const put = (path: string) =>
      "insert into storage.objects (bucket_id, name) values ('channel-media', '" + path + "')";

    await as(owner.id, (q) => q(put(`${ch}/brand/logo.png`)));
    await as(owner.id, (q) => q(put(`${ch}/presenter/a.jpg`)));
    // Los recursos de episodios y las rutas sin canal no las sube un usuario.
    await expect(as(owner.id, (q) => q(put(`${ch}/episodes/x/m.png`)))).rejects.toThrow(
      /row-level security/,
    );
    await expect(as(owner.id, (q) => q(put("sin-canal/brand/x.png")))).rejects.toThrow(
      /row-level security/,
    );
    await expect(as(viewer.id, (q) => q(put(`${ch}/brand/otro.png`)))).rejects.toThrow(
      /row-level security/,
    );
    await expect(as(outsider.id, (q) => q(put(`${ch}/brand/otro.png`)))).rejects.toThrow(
      /row-level security/,
    );

    const list = "select name from storage.objects where bucket_id = 'channel-media' order by name";
    expect(await as(viewer.id, (q) => q(list))).toEqual([
      { name: `${ch}/brand/logo.png` },
      { name: `${ch}/presenter/a.jpg` },
    ]);
    expect(await as(outsider.id, (q) => q(list))).toEqual([]);
    expect(
      await as(viewer.id, (q) =>
        q("delete from storage.objects where name like $1 returning 1", [`${ch}/%`]),
      ),
    ).toEqual([]);
    expect(
      await as(owner.id, (q) =>
        q("delete from storage.objects where name = $1 returning 1", [`${ch}/presenter/a.jpg`]),
      ),
    ).toEqual([{ "?column?": 1 }]);
  });

  it("el kit y las fotos llevan rutas de su canal", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const ws = await createWorkspace(owner.id);
    await addMember(ws, viewer.id, "viewer");
    const ch = await createChannel(ws);
    const other = await createChannel(ws, "Otro", "OT");

    await as(owner.id, (q) =>
      q("insert into public.brand_kits (channel_id, logo_path, style) values ($1, $2, $3)", [
        ch,
        `${ch}/brand/logo.png`,
        { grid: { columns: 12 } },
      ]),
    );
    await expect(
      sql("update public.brand_kits set logo_path = $2 where channel_id = $1", [
        ch,
        `${other}/brand/logo.png`,
      ]),
    ).rejects.toThrow(/brand_kits_logo_path/);
    await expect(
      as(viewer.id, (q) => q("insert into public.brand_kits (channel_id) values ($1)", [other])),
    ).rejects.toThrow(/row-level security/);

    const [photo] = await as(owner.id, (q) =>
      q(
        "insert into public.presenter_photos (channel_id, path, label) values ($1, $2, 'Frente') returning workspace_id, created_by",
        [ch, `${ch}/presenter/1.jpg`],
      ),
    );
    expect(photo).toEqual({ workspace_id: ws, created_by: owner.id });
    await expect(
      sql("insert into public.presenter_photos (channel_id, path) values ($1, $2)", [
        ch,
        `${other}/presenter/1.jpg`,
      ]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      sql("insert into public.presenter_photos (channel_id, path) values ($1, $2)", [
        ch,
        `${ch}/brand/1.jpg`,
      ]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(viewer.id, (q) =>
        q("insert into public.presenter_photos (channel_id, path) values ($1, $2)", [
          ch,
          `${ch}/presenter/2.jpg`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await as(viewer.id, (q) =>
        q("select label from public.presenter_photos where channel_id = $1", [ch]),
      ),
    ).toEqual([{ label: "Frente" }]);
    expect(
      await as(viewer.id, (q) =>
        q("delete from public.presenter_photos where channel_id = $1 returning 1", [ch]),
      ),
    ).toEqual([]);
  });
});

describe("Fase 3 · miniaturas", () => {
  it("las miniaturas las escribe el servidor; una sola elegida por episodio", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    await addMember(ws, viewer.id, "viewer");
    const ch = await createChannel(ws);
    const ep = await createEpisode(ch);
    const insert = (idx: number) =>
      sql(
        "insert into public.episode_assets (episode_id, channel_id, design_idx) values ($1, $2, $3) returning id, workspace_id, status",
        [ep, ch, idx],
      );
    const [a] = await insert(0);
    expect(a).toMatchObject({ workspace_id: ws, status: "queued" });
    const [b] = await insert(1);
    await sql("update public.episode_assets set chosen = true where id = $1", [a.id]);
    await expect(
      sql("update public.episode_assets set chosen = true where id = $1", [b.id]),
    ).rejects.toThrow(/episode_assets_one_chosen/);
    await expect(
      sql("update public.episode_assets set path = $2 where id = $1", [a.id, `${ch}/brand/x.jpg`]),
    ).rejects.toThrow(/check constraint/);
    await sql("update public.episode_assets set path = $2 where id = $1", [
      a.id,
      `${ch}/episodes/${ep}/thumbnails/${a.id}.jpg`,
    ]);
    // Posición del texto: lado y altura, o null (automático).
    await sql(
      "update public.episode_assets set text_side = 'right', text_v = 'bottom' where id = $1",
      [a.id],
    );
    await expect(
      sql("update public.episode_assets set text_v = 'abajo' where id = $1", [a.id]),
    ).rejects.toThrow(/check constraint/);

    expect(
      (
        await as(viewer.id, (q) =>
          q("select id from public.episode_assets where episode_id = $1", [ep]),
        )
      ).length,
    ).toBe(2);
    expect(
      await as(outsider.id, (q) =>
        q("select id from public.episode_assets where episode_id = $1", [ep]),
      ),
    ).toEqual([]);
    await expect(
      as(owner.id, (q) =>
        q(
          "insert into public.episode_assets (episode_id, channel_id, design_idx) values ($1, $2, 2)",
          [ep, ch],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await as(owner.id, (q) =>
        q("update public.episode_assets set chosen = false where id = $1 returning 1", [a.id]),
      ),
    ).toEqual([]);
  });

  it("las fotos del producto las sube quien escribe guiones, en refs/ de su episodio", async () => {
    const owner = await createUser();
    const writer = await createUser();
    const viewer = await createUser();
    const ws = await createWorkspace(owner.id);
    await addMember(ws, writer.id, "writer");
    await addMember(ws, viewer.id, "viewer");
    const ch = await createChannel(ws);
    const other = await createChannel(ws, "Otro", "OT");
    const ep = await createEpisode(ch);
    const epOther = await createEpisode(other);
    const ref = `${ch}/episodes/${ep}/refs/a.jpg`;
    const put = (path: string) =>
      "insert into storage.objects (bucket_id, name) values ('channel-media', '" + path + "')";

    await as(writer.id, (q) => q(put(ref)));
    await expect(
      as(writer.id, (q) => q(put(`${ch}/episodes/${ep}/thumbnails/x.jpg`))),
    ).rejects.toThrow(/row-level security/);
    await expect(as(viewer.id, (q) => q(put(`${ch}/episodes/${ep}/refs/b.jpg`)))).rejects.toThrow(
      /row-level security/,
    );

    await as(writer.id, (q) =>
      q(
        "insert into public.episode_refs (episode_id, channel_id, path, label) values ($1, $2, $3, 'Caja')",
        [ep, ch, ref],
      ),
    );
    // El episodio tiene que ser del canal, y la ruta, de ese episodio.
    await expect(
      as(writer.id, (q) =>
        q("insert into public.episode_refs (episode_id, channel_id, path) values ($1, $2, $3)", [
          epOther,
          ch,
          `${ch}/episodes/${epOther}/refs/c.jpg`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      sql("insert into public.episode_refs (episode_id, channel_id, path) values ($1, $2, $3)", [
        ep,
        ch,
        `${ch}/episodes/${ep}/thumbnails/c.jpg`,
      ]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(viewer.id, (q) =>
        q("insert into public.episode_refs (episode_id, channel_id, path) values ($1, $2, $3)", [
          ep,
          ch,
          `${ch}/episodes/${ep}/refs/d.jpg`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await as(viewer.id, (q) =>
        q("select label from public.episode_refs where episode_id = $1", [ep]),
      ),
    ).toEqual([{ label: "Caja" }]);
    expect(
      await as(writer.id, (q) =>
        q("delete from public.episode_refs where episode_id = $1 returning 1", [ep]),
      ),
    ).toEqual([{ "?column?": 1 }]);
    expect(
      await as(writer.id, (q) =>
        q("delete from storage.objects where name = $1 returning 1", [ref]),
      ),
    ).toEqual([{ "?column?": 1 }]);
  });

  it("el consumo separa el gasto en imágenes y acepta el presupuesto de Gemini", async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner.id);
    await sql(
      `insert into public.usage_ledger (workspace_id, kind, credits, cost_usd, meta) values
        ($1, 'thumbnail_image', 7, 0.07, '{"model":"gemini-x","images":1,"image_usd":0.07}'),
        ($1, 'thumbnail_image', 7, 0.07, '{"model":"gemini-x","images":1,"image_usd":0.07}')`,
      [ws],
    );
    const [row] = await sql(
      "select calls, images, image_usd from public.usage_breakdown(now() - interval '1 day', now() + interval '1 day') where workspace_id = $1",
      [ws],
    );
    expect([Number(row.calls), Number(row.images), Number(row.image_usd)]).toEqual([2, 2, 0.14]);
    const [month] = await sql("select image_usd from public.usage_monthly(1)");
    expect(Number(month.image_usd)).toBeGreaterThanOrEqual(0.14);
    await sql(
      "insert into public.service_budgets (service, monthly_usd) values ('gemini', 10) on conflict (service) do update set monthly_usd = 10",
    );
  });
});

describe("Fase 3 · textos para miniaturas", () => {
  it("los escribe el servidor, los lee quien ve el canal y hay uno por tarjeta", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    const ep = await createEpisode(ch);
    const insert = (text: string, slot: number | null) =>
      sql(
        "insert into public.thumbnail_ideas (episode_id, channel_id, scheme, angle, text, slot) values ($1, $2, 'A', 'El dinero', $3, $4) returning id, workspace_id",
        [ep, ch, text, slot],
      );
    const [a] = await insert("¿Pagar más?", 0);
    expect(a.workspace_id).toBe(ws);
    await insert("No compres 8 GB", null);
    await expect(insert("8 GB vs 16 GB", 0)).rejects.toThrow(/duplicate key/);
    await expect(insert("Otro", 3)).rejects.toThrow(/check constraint/);
    // Cada texto lleva un esquema de la guía (A a F).
    await expect(
      sql(
        "insert into public.thumbnail_ideas (episode_id, channel_id, scheme, angle, text) values ($1, $2, 'G', 'x', 'y')",
        [ep, ch],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      sql(
        "insert into public.thumbnail_ideas (episode_id, channel_id, angle, text) values ($1, $2, 'x', 'y')",
        [ep, ch],
      ),
    ).rejects.toThrow(/not-null/);

    // La versión guarda el esquema, el escenario, el espejo y los avisos.
    const [asset] = await sql(
      "insert into public.episode_assets (episode_id, channel_id, design_idx, idea_id, scheme, scenario, mirror, layout_warnings) values ($1, $2, 0, $3, 'A', 'sofá', true, $4) returning id, mirror, layout_warnings",
      [ep, ch, a.id, ["El texto queda a menos de 40 px de la cara."]],
    );
    expect(asset).toMatchObject({
      mirror: true,
      layout_warnings: ["El texto queda a menos de 40 px de la cara."],
    });
    // Las opciones de la miniatura y el título del texto.
    const [opts] = await sql(
      "select no_text, no_person, no_product from public.episode_assets where id = $1",
      [asset.id],
    );
    expect(opts).toEqual({ no_text: false, no_person: false, no_product: false });
    const [titled] = await sql(
      "insert into public.thumbnail_ideas (episode_id, channel_id, scheme, angle, text, title) values ($1, $2, 'B', 'x', '40% más barato', 'MacBook Air M4: lo que no te dicen') returning title",
      [ep, ch],
    );
    expect(titled.title).toBe("MacBook Air M4: lo que no te dicen");
    await sql("delete from public.thumbnail_ideas where title <> ''");
    await expect(
      sql(
        "insert into public.thumbnail_ideas (episode_id, channel_id, scheme, angle, text, title) values ($1, $2, 'B', 'x', 'y', $3)",
        [ep, ch, "t".repeat(101)],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      sql(
        "insert into public.episode_assets (episode_id, channel_id, design_idx, scheme) values ($1, $2, 1, 'Z')",
        [ep, ch],
      ),
    ).rejects.toThrow(/check constraint/);
    await sql("delete from public.thumbnail_ideas where id = $1", [a.id]);
    const [after] = await sql("select idea_id from public.episode_assets where id = $1", [
      asset.id,
    ]);
    expect(after.idea_id).toBeNull();

    expect(
      await as(owner.id, (q) =>
        q("select text from public.thumbnail_ideas where episode_id = $1", [ep]),
      ),
    ).toEqual([{ text: "No compres 8 GB" }]);
    expect(
      await as(outsider.id, (q) =>
        q("select text from public.thumbnail_ideas where episode_id = $1", [ep]),
      ),
    ).toEqual([]);
    await expect(
      as(owner.id, (q) =>
        q(
          "insert into public.thumbnail_ideas (episode_id, channel_id, scheme, angle, text) values ($1, $2, 'A', 'x', 'y')",
          [ep, ch],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("Fase 3 · plan de ayudas visuales", () => {
  it("lo escribe el servidor, lo lee quien ve el canal y valida tipo, código y pieza", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    const ep = await createEpisode(ch);
    const insert = (kind: string, code: string, piece: string | null = null) =>
      sql(
        "insert into public.visual_aids (episode_id, channel_id, kind, code, anchor, title, piece, claim_rows, elements) values ($1, $2, $3, $4, 'En las pruebas', 'Batería', $5, '{1,2}', '[{\"text\":\"Horas de batería\",\"value\":\"18\"}]') returning id, workspace_id, status, claim_rows",
        [ep, ch, kind, code, piece],
      );
    const [m] = await insert("M", "M1", "bars");
    expect(m).toMatchObject({ workspace_id: ws, status: "proposed", claim_rows: [1, 2] });
    await insert("C", "C1");
    await expect(insert("X", "X1")).rejects.toThrow(/check constraint/);
    await expect(insert("M", "M-1")).rejects.toThrow(/check constraint/);
    await expect(insert("M", "M2", "sparkles")).rejects.toThrow(/check constraint/);
    await expect(
      sql("update public.visual_aids set status = 'done' where id = $1", [m.id]),
    ).rejects.toThrow(/check constraint/);

    expect(
      await as(owner.id, (q) =>
        q("select code from public.visual_aids where episode_id = $1 order by code", [ep]),
      ),
    ).toEqual([{ code: "C1" }, { code: "M1" }]);
    expect(
      await as(outsider.id, (q) =>
        q("select code from public.visual_aids where episode_id = $1", [ep]),
      ),
    ).toEqual([]);
    await expect(
      as(owner.id, (q) =>
        q(
          "insert into public.visual_aids (episode_id, channel_id, kind, code, anchor, title) values ($1, $2, 'C', 'C2', 'x', 'y')",
          [ep, ch],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("Fase 3 · render de las ayudas visuales", () => {
  it("un render por ayuda y formato, ruta del canal, y el bucket acepta video", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id);
    await createWorkspace(outsider.id, "Ajeno");
    const ch = await createChannel(ws);
    const ep = await createEpisode(ch);
    const [aid] = await sql(
      "insert into public.visual_aids (episode_id, channel_id, kind, code, anchor, title) values ($1, $2, 'C', 'C1', 'La memoria', 'Memoria unificada') returning id",
      [ep, ch],
    );
    const insert = (format: string, path: string | null = null) =>
      sql(
        "insert into public.aid_renders (visual_aid_id, episode_id, channel_id, format, path) values ($1, $2, $3, $4, $5) returning id, workspace_id, status, render_version",
        [aid.id, ep, ch, format, path],
      );
    const [green] = await insert("green", `${ch}/episodes/${ep}/aids/C1-green.mp4`);
    // Sin versión, cuenta como un render viejo (sin sonido).
    expect(green).toMatchObject({ workspace_id: ws, status: "queued", render_version: 1 });
    await expect(insert("green")).rejects.toThrow(/duplicate key/);
    await expect(insert("square")).rejects.toThrow(/check constraint/);
    await expect(insert("alpha", `${ch}/otra/${ep}/C1.webm`)).rejects.toThrow(/check constraint/);

    const [bucket] = await sql(
      "select file_size_limit, allowed_mime_types from storage.buckets where id = 'channel-media'",
    );
    expect(Number(bucket.file_size_limit)).toBe(50 * 1024 * 1024);
    expect(bucket.allowed_mime_types).toEqual(expect.arrayContaining(["video/mp4", "video/webm"]));

    expect(
      await as(owner.id, (q) =>
        q("select format from public.aid_renders where episode_id = $1", [ep]),
      ),
    ).toEqual([{ format: "green" }]);
    expect(
      await as(outsider.id, (q) =>
        q("select format from public.aid_renders where episode_id = $1", [ep]),
      ),
    ).toEqual([]);
    // Borrar la ayuda borra sus renders.
    await sql("delete from public.visual_aids where id = $1", [aid.id]);
    expect(await sql("select id from public.aid_renders where episode_id = $1", [ep])).toEqual([]);
  });
});
