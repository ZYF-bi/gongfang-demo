import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as derive,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "./errors";

const scrypt = promisify(derive);
export const LOCAL_COOKIE = "xiaoyan_local_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const GUEST_SESSION_SECONDS = 365 * 24 * 60 * 60;
export function guestEnabled() {
  return localEnabled() && process.env.LOCAL_ACCESS_MODE !== "account";
}
export type LocalDatabase = { kind: "local"; userId: string };
export function localEnabled() {
  if (process.env.AUTH_BACKEND !== "local") return false;
  let hostname = "";
  try {
    hostname = new URL(process.env.APP_ORIGIN || "").hostname;
  } catch {
    /* invalid setup */
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname))
    throw new AppError(
      "SETUP_REQUIRED",
      "本地账号模式仅支持本机地址；公开部署请使用 Supabase",
      503,
    );
  return true;
}

declare global {
  var xiaoyanLocalDatabase: Promise<PGlite> | undefined;
}
export async function localDatabase() {
  if (!globalThis.xiaoyanLocalDatabase)
    globalThis.xiaoyanLocalDatabase = initialize();
  try {
    return await globalThis.xiaoyanLocalDatabase;
  } catch (error) {
    globalThis.xiaoyanLocalDatabase = undefined;
    throw error;
  }
}
async function initialize() {
  const directory = resolve(process.env.LOCAL_DATA_DIR || ".data/postgres");
  await mkdir(directory, { recursive: true });
  const db = new PGlite(directory);
  await db.waitReady;
  const result = await db.query<{ exists: boolean }>(
    "select to_regclass('public.local_sessions') is not null as exists",
  );
  if (!result.rows[0].exists) {
    await db.transaction(async (tx) => {
      await tx.exec(`
      create schema if not exists auth;
      create role anon;
      create role authenticated;
      create table auth.users(id uuid primary key, email text unique not null, password_hash text not null, salt text not null, created_at timestamptz not null default now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
      await tx.exec(
        (
          await readFile(
            resolve("supabase/migrations/202609240001_initial.sql"),
            "utf8",
          )
        )
          .replace(/^begin;\s*$/gm, "")
          .replace(/^commit;\s*$/gm, ""),
      );
      await tx.exec(`
      create table public.local_sessions(token_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade, expires_at timestamptz not null);
      create table public.local_auth_attempts(email_hash text not null, operation text not null, created_at timestamptz not null default now());
      create index local_attempt_time on public.local_auth_attempts(created_at);
      revoke all on public.local_sessions, public.local_auth_attempts from anon, authenticated;
    `);
    });
  }
  // Additive migration: retain existing accounts, sessions and projects.
  await db.exec(
    "alter table auth.users add column if not exists is_guest boolean not null default false",
  );
  return db;
}

// One transaction owns identity and role for the entire query. No cross-request identity state.
export async function localQuery<T>(
  userId: string,
  sql: string,
  params: unknown[] = [],
) {
  const db = await localDatabase();
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId,
    ]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function admitAuth(email: string, operation: string) {
  const db = await localDatabase();
  await db.transaction(async (tx) => {
    await tx.exec(
      "delete from public.local_auth_attempts where created_at < now() - interval '1 day'; delete from public.local_sessions where expires_at < now();",
    );
    const result = await tx.query<{ total: number; account: number }>(
      `select count(*)::int as total, count(*) filter (where email_hash=$1)::int as account from public.local_auth_attempts where created_at > now() - interval '15 minutes'`,
      [digest(email)],
    );
    if (result.rows[0].total >= 100 || result.rows[0].account >= 15)
      throw new AppError("RATE_LIMIT", "操作过于频繁，请 15 分钟后再试", 429);
    await tx.query(
      "insert into public.local_auth_attempts(email_hash,operation) values($1,$2)",
      [digest(email), operation],
    );
  });
}
async function sessionFor(user: { id: string; email: string }) {
  const token = randomBytes(32).toString("base64url");
  const db = await localDatabase();
  await db.query(
    "insert into public.local_sessions(token_hash,user_id,expires_at) values($1,$2,$3)",
    [digest(token), user.id, new Date(Date.now() + SESSION_SECONDS * 1000)],
  );
  return { user, token };
}
export async function localRegister(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  await admitAuth(email, "register");
  const salt = randomBytes(16).toString("hex");
  const hash = ((await scrypt(password, salt, 64)) as Buffer).toString("hex");
  const user = { id: randomUUID(), email };
  const db = await localDatabase();
  try {
    await db.query(
      "insert into auth.users(id,email,password_hash,salt) values($1,$2,$3,$4)",
      [user.id, email, hash, salt],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new AppError("REGISTER_FAILED", "该邮箱已注册，请直接登录", 409);
    throw error;
  }
  return sessionFor(user);
}
export async function localLogin(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  await admitAuth(email, "login");
  const db = await localDatabase();
  const result = await db.query<{
    id: string;
    email: string;
    password_hash: string;
    salt: string;
    is_guest: boolean;
  }>(
    "select id,email,password_hash,salt,is_guest from auth.users where email=$1",
    [email],
  );
  const user = result.rows[0];
  const actual = (await scrypt(
    password,
    user?.salt ?? "dummy-salt-for-missing-user",
    64,
  )) as Buffer;
  const expected = Buffer.from(user?.password_hash ?? "00".repeat(64), "hex");
  if (!timingSafeEqual(actual, expected) || !user || user.is_guest)
    throw new AppError("LOGIN_FAILED", "邮箱或密码错误", 401);
  return sessionFor({ id: user.id, email: user.email });
}
export async function localSession(token: string | undefined) {
  if (!token) throw new AppError("UNAUTHORIZED", "请先登录或重新登录", 401);
  const db = await localDatabase();
  const { rows } = await db.query<{
    id: string;
    email: string;
    is_guest: boolean;
  }>(
    "select u.id,u.email,u.is_guest from auth.users u join public.local_sessions s on s.user_id=u.id where s.token_hash=$1 and s.expires_at > now()",
    [digest(token)],
  );
  if (!rows[0]) throw new AppError("UNAUTHORIZED", "请先登录或重新登录", 401);
  return rows[0];
}
export async function localGuestSession(existingToken?: string) {
  if (existingToken) {
    try {
      const user = await localSession(existingToken);
      return {
        user,
        token: existingToken,
        seconds: user.is_guest ? GUEST_SESSION_SECONDS : SESSION_SECONDS,
      };
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 401) throw error;
    }
  }
  await admitAuth("anonymous-workspace", "guest");
  const user = {
    id: randomUUID(),
    email: `guest-${randomUUID()}@local.invalid`,
    is_guest: true,
  };
  const token = randomBytes(32).toString("base64url");
  const db = await localDatabase();
  await db.transaction(async (tx) => {
    await tx.query(
      "insert into auth.users(id,email,password_hash,salt,is_guest) values($1,$2,$3,$4,true)",
      [
        user.id,
        user.email,
        randomBytes(64).toString("hex"),
        randomBytes(16).toString("hex"),
      ],
    );
    await tx.query(
      "insert into public.local_sessions(token_hash,user_id,expires_at) values($1,$2,$3)",
      [
        digest(token),
        user.id,
        new Date(Date.now() + GUEST_SESSION_SECONDS * 1000),
      ],
    );
  });
  return { user, token, seconds: GUEST_SESSION_SECONDS };
}
export async function localLogout(token: string | undefined) {
  if (!token) return;
  const db = await localDatabase();
  await db.query("delete from public.local_sessions where token_hash=$1", [
    digest(token),
  ]);
}
