import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  localDatabase,
  localLogin,
  localLogout,
  localRegister,
  localSession,
  localGuestSession,
  GUEST_SESSION_SECONDS,
} from "@/lib/local-db";
import {
  beginGeneration,
  finish,
  getProject,
  listProjects,
} from "@/lib/projects";
let originalDir: string | undefined;
describe("real local account and persistent database", () => {
  beforeAll(() => {
    originalDir = process.env.LOCAL_DATA_DIR;
    process.env.LOCAL_DATA_DIR = `.data/test-${randomUUID()}`;
  });
  afterAll(async () => {
    await (await localDatabase()).close();
    globalThis.xiaoyanLocalDatabase = undefined;
    if (originalDir) process.env.LOCAL_DATA_DIR = originalDir;
    else delete process.env.LOCAL_DATA_DIR;
  });
  it("registers, verifies passwords, hashes secrets and revokes sessions", async () => {
    const account = await localRegister("alpha@example.com", "LocalTest123");
    expect((await localSession(account.token)).email).toBe("alpha@example.com");
    await expect(
      localLogin("alpha@example.com", "incorrect123"),
    ).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    await expect(
      localRegister("ALPHA@example.com", "LocalTest123"),
    ).rejects.toMatchObject({ code: "REGISTER_FAILED" });
    const db = await localDatabase();
    const rows = await db.query<{ password_hash: string }>(
      "select password_hash from auth.users where id=$1",
      [account.user.id],
    );
    expect(rows.rows[0].password_hash).not.toContain("LocalTest123");
    await localLogout(account.token);
    await expect(localSession(account.token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(
      (await localLogin("alpha@example.com", "LocalTest123")).user.id,
    ).toBe(account.user.id);
  });
  it("saves real projects, isolates users even for parallel reads, and persists across reopen", async () => {
    const a = await localLogin("alpha@example.com", "LocalTest123");
    const b = await localRegister("beta@example.com", "LocalTest123");
    const dbA = { kind: "local" as const, userId: a.user.id };
    const dbB = { kind: "local" as const, userId: b.user.id };
    const input = {
      requestId: randomUUID(),
      projectId: randomUUID(),
      revision: 0,
      prompt: "test persistence",
    };
    await beginGeneration(dbA, input, "test-fingerprint");
    await finish(
      dbA,
      input.requestId,
      "<html><body>persistent app</body></html>",
    );
    const reads = await Promise.all([
      listProjects(dbA),
      listProjects(dbB),
      listProjects(dbA),
      listProjects(dbB),
    ]);
    expect(reads.map((v) => v.length)).toEqual([1, 0, 1, 0]);
    await expect(getProject(dbB, input.projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await (await localDatabase()).close();
    globalThis.xiaoyanLocalDatabase = undefined;
    expect((await localSession(a.token)).id).toBe(a.user.id);
    expect((await getProject(dbA, input.projectId)).html).toContain(
      "persistent app",
    );
  });
  it("creates isolated guest workspaces, reuses sessions and restores saved data after reopen", async () => {
    const a = await localGuestSession();
    const b = await localGuestSession();
    expect(a.user.id).not.toBe(b.user.id);
    expect(a.user.is_guest).toBe(true);
    expect(a.seconds).toBe(GUEST_SESSION_SECONDS);
    expect((await localGuestSession(a.token)).token).toBe(a.token);
    const account = await localLogin("alpha@example.com", "LocalTest123");
    expect((await localGuestSession(account.token)).user.id).toBe(
      account.user.id,
    );
    await expect(localLogin(a.user.email, "anything123")).rejects.toMatchObject(
      { code: "LOGIN_FAILED" },
    );
    const dbA = { kind: "local" as const, userId: a.user.id };
    const dbB = { kind: "local" as const, userId: b.user.id };
    const input = {
      requestId: randomUUID(),
      projectId: randomUUID(),
      revision: 0,
      prompt: "guest persistence test",
    };
    await beginGeneration(dbA, input, "guest-fingerprint");
    await finish(
      dbA,
      input.requestId,
      "<html><body>guest saved project</body></html>",
    );
    expect(await listProjects(dbB)).toHaveLength(0);
    await expect(getProject(dbB, input.projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await (await localDatabase()).close();
    globalThis.xiaoyanLocalDatabase = undefined;
    expect((await localSession(a.token)).id).toBe(a.user.id);
    expect((await getProject(dbA, input.projectId)).html).toContain(
      "guest saved project",
    );
    await localLogout(a.token);
    const replacement = await localGuestSession(a.token);
    expect(replacement.user.id).not.toBe(a.user.id);
    expect(
      await listProjects({ kind: "local", userId: replacement.user.id }),
    ).toHaveLength(0);
    // Invalid session replacement cannot grant access to the old workspace.
    expect((await getProject(dbA, input.projectId)).html).toContain(
      "guest saved project",
    );
  });
});
