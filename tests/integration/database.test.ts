import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P = "11111111-1111-4111-8111-111111111111",
  Q = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const HTML = "<html><body>hello</body></html>";
let db: PGlite;
async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}
async function begin(
  id = R,
  project = P,
  revision = 0,
  prompt = "todo",
  fingerprint = id,
) {
  const result = await db.query<{
    value: { created: boolean; status: string };
  }>("select public.begin_generation($1,$2,$3,$4,$5) as value", [
    id,
    project,
    revision,
    prompt,
    fingerprint,
  ]);
  return result.rows[0].value;
}
async function finish(id = R, html = HTML) {
  const result = await db.query<{
    value: {
      id: string;
      revision: number;
      html: string;
      applied_changes: string[];
    };
  }>("select public.finish_generation($1,$2) as value", [id, html]);
  return result.rows[0].value;
}
describe("real SQL migration on local PostgreSQL (PGlite), not cloud Supabase", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create schema auth; create role anon; create role authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;`);
    await db.exec(
      await readFile("supabase/migrations/202609240001_initial.sql", "utf8"),
    );
  });
  beforeEach(async () => {
    await db.exec("reset role; truncate auth.users cascade;");
    await db.query("insert into auth.users values ($1),($2)", [A, B]);
    await asUser(A);
  });
  afterAll(async () => {
    await db?.close();
  });
  it("saves once, deduplicates request admission and save retries", async () => {
    expect((await begin()).created).toBe(true);
    expect((await begin()).created).toBe(false);
    expect((await finish()).revision).toBe(1);
    expect((await finish()).revision).toBe(1);
    expect((await db.query("select * from public.projects")).rows).toHaveLength(
      1,
    );
  });
  it("enforces cross-account read and write isolation", async () => {
    await begin();
    await finish();
    await asUser(B);
    expect((await db.query("select * from public.projects")).rows).toHaveLength(
      0,
    );
    expect(
      (await db.query("select * from public.generation_requests")).rows,
    ).toHaveLength(0);
    await expect(finish()).rejects.toThrow("NOT_FOUND");
    await expect(begin(Q, P, 1, "modify")).rejects.toThrow("NOT_FOUND");
  });
  it("denies anonymous access and direct writes", async () => {
    await expect(
      db.exec(
        `insert into public.projects(id,user_id,name,original_prompt,html,last_request_id) values('${P}','${A}','x','x','x','${R}')`,
      ),
    ).rejects.toThrow("permission denied");
    await db.exec("set role anon");
    await expect(db.exec("select * from public.projects")).rejects.toThrow(
      "permission denied",
    );
    await expect(begin()).rejects.toThrow("permission denied");
  });
  it("rejects different payloads for the same request ID", async () => {
    await begin();
    await expect(
      begin(R, P, 0, "different", "new-fingerprint"),
    ).rejects.toThrow("REQUEST_CONFLICT");
  });
  it("blocks concurrent pending operations and permits a retry after failure", async () => {
    await begin();
    await expect(begin(Q, Q)).rejects.toThrow("BUSY");
    await db.query(
      "select public.mark_generation($1,'failed','MODEL_ERROR',null)",
      [R],
    );
    expect((await begin(Q, Q)).created).toBe(true);
  });
  it("preserves old code on failed modification and prevents stale updates", async () => {
    await begin();
    await finish();
    await begin(Q, P, 1, "add filter");
    await db.query(
      "select public.mark_generation($1,'failed','MODEL_ERROR',null)",
      [Q],
    );
    expect(
      (await db.query<{ html: string }>("select html from public.projects"))
        .rows[0].html,
    ).toBe(HTML);
    const next = "44444444-4444-4444-8444-444444444444";
    await begin(next, P, 1, "add filter");
    const saved = await finish(next, "<html><body>changed</body></html>");
    expect(saved.revision).toBe(2);
    expect(saved.applied_changes).toEqual(["add filter"]);
    await expect(
      begin("55555555-5555-4555-8555-555555555555", P, 1, "stale"),
    ).rejects.toThrow("CONFLICT");
  });
  it("retries unsaved results without creating another generation", async () => {
    await begin();
    await db.query(
      "select public.mark_generation($1,'unsaved','SAVE_FAILED',null)",
      [R],
    );
    expect((await finish()).revision).toBe(1);
    expect(
      (await db.query("select * from public.generation_requests")).rows,
    ).toHaveLength(1);
  });
  it("expires abandoned operations and rejects their late writes", async () => {
    await begin();
    await db.exec("reset role");
    await db.exec(
      "update public.generation_requests set created_at = now() - interval '3 minutes'",
    );
    await asUser(A);
    await begin(Q, Q);
    await expect(finish(R)).rejects.toThrow("EXPIRED");
  });
  it("enforces hourly rate limit in the database", async () => {
    for (let i = 0; i < 10; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      await begin(id, Q);
      await db.query(
        "select public.mark_generation($1,'failed','MODEL_ERROR',null)",
        [id],
      );
    }
    await expect(begin()).rejects.toThrow("RATE_LIMIT");
  });
});
