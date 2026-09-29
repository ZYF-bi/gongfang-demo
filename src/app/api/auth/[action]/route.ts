import { checkOrigin, json, readJson, route, supabase } from "@/lib/server";
import { loginSchema, registerSchema } from "@/lib/validation";
import { AppError } from "@/lib/errors";
import { cookies } from "next/headers";
import {
  LOCAL_COOKIE,
  SESSION_SECONDS,
  localEnabled,
  localLogin,
  localLogout,
  localRegister,
  guestEnabled,
  localGuestSession,
} from "@/lib/local-db";

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return route(async () => {
    checkOrigin(request);
    const { action } = await context.params;
    if (localEnabled()) {
      const jar = await cookies();
      if (action === "guest") {
        if (!guestEnabled())
          throw new AppError("NOT_FOUND", "访客模式未启用", 404);
        const result = await localGuestSession(jar.get(LOCAL_COOKIE)?.value);
        jar.set(LOCAL_COOKIE, result.token, {
          httpOnly: true,
          sameSite: "lax",
          secure: new URL(process.env.APP_ORIGIN!).protocol === "https:",
          path: "/",
          maxAge: result.seconds,
        });
        return json({ user: { id: result.user.id, email: result.user.email } });
      }
      if (action === "logout") {
        await localLogout(jar.get(LOCAL_COOKIE)?.value);
        jar.delete(LOCAL_COOKIE);
        return json({ ok: true });
      }
      if (action !== "login" && action !== "register")
        throw new AppError("NOT_FOUND", "接口不存在", 404);
      const input =
        action === "register"
          ? await readJson(request, registerSchema, 4000)
          : await readJson(request, loginSchema, 4000);
      const result = await (action === "register" ? localRegister : localLogin)(
        input.email,
        input.password,
      );
      // A prior account's session must not remain active after switching accounts.
      await localLogout(jar.get(LOCAL_COOKIE)?.value);
      jar.set(LOCAL_COOKIE, result.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(process.env.APP_ORIGIN!).protocol === "https:",
        path: "/",
        maxAge: SESSION_SECONDS,
      });
      return json({ user: result.user });
    }
    const db = await supabase();
    if (action === "logout") {
      const { error } = await db.auth.signOut({ scope: "local" });
      if (error) throw new AppError("AUTH_ERROR", "退出失败，请重试", 503);
      return json({ ok: true });
    }
    if (action === "register") {
      const input = await readJson(request, registerSchema, 4000);
      const { data, error } = await db.auth.signUp({
        email: input.email,
        password: input.password,
      });
      if (error || !data.session || !data.user)
        throw new AppError(
          "REGISTER_FAILED",
          error?.status === 429
            ? "注册操作过于频繁，请稍后再试"
            : "注册未完成，请尝试登录；如为新账号，请检查服务是否启用了邮件确认",
          400,
        );
      return json({ user: { id: data.user.id, email: data.user.email } });
    }
    if (action === "login") {
      const input = await readJson(request, loginSchema, 4000);
      const { data, error } = await db.auth.signInWithPassword(input);
      if (error || !data.user)
        throw new AppError(
          "LOGIN_FAILED",
          error?.status === 429
            ? "登录过于频繁，请稍后再试"
            : (error?.status ?? 0) >= 500
              ? "账号服务暂不可用，请稍后重试"
              : "邮箱或密码错误",
          401,
        );
      return json({ user: { id: data.user.id, email: data.user.email } });
    }
    throw new AppError("NOT_FOUND", "接口不存在", 404);
  });
}
