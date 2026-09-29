import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";
import {
  LOCAL_COOKIE,
  guestEnabled,
  localEnabled,
  localSession,
} from "./local-db";
import type { Database } from "./projects";

export function configured() {
  return {
    guest: guestEnabled(),
    auth:
      localEnabled() ||
      Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    model: Boolean(
      process.env.MODEL_API_KEY &&
        process.env.MODEL_NAME &&
        process.env.MODEL_API_BASE_URL,
    ),
  };
}
export async function supabase() {
  if (!configured().auth)
    throw new AppError(
      "SETUP_REQUIRED",
      "账号服务尚未配置，请按 README 完成 Supabase 配置",
      503,
    );
  const jar = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
      },
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          for (const { name, value, options } of values)
            jar.set(name, value, options);
        },
      },
    },
  );
}
export async function authenticated() {
  if (localEnabled()) {
    const user = await localSession((await cookies()).get(LOCAL_COOKIE)?.value);
    return { user, db: { kind: "local", userId: user.id } as Database };
  }
  const db = await supabase();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new AppError("UNAUTHORIZED", "请先登录或重新登录", 401);
  return { db, user: data.user };
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new AppError("SETUP_REQUIRED", "服务地址尚未配置", 503);
  if (origin !== new URL(expected).origin)
    throw new AppError("FORBIDDEN", "请求来源不被允许", 403);
}
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit = 240_000,
): Promise<T> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw new AppError("TOO_LARGE", "请求内容过大", 413);
  if (!request.body) throw new AppError("INVALID_INPUT", "请求内容为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new AppError("TOO_LARGE", "请求内容过大", 413);
    }
    chunks.push(value);
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new AppError("INVALID_INPUT", error.issues[0].message);
    throw new AppError("INVALID_INPUT", "请求格式不正确");
  }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function route(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError)
      return json({ code: error.code, message: error.message }, error.status);
    return json(
      { code: "UNEXPECTED", message: "服务暂不可用，请稍后重试" },
      500,
    );
  }
}
