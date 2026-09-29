// Real HTTP only. No model calls and no credentials are written to evidence.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const base = "http://127.0.0.1:3000";
const checks = [];
async function call(path, method = "GET", cookie = "", body, origin = base) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
    cookies: response.headers.getSetCookie(),
  };
}
function passed(name) {
  checks.push({ name, status: "passed" });
}
const initial = await call("/api/session");
assert.equal(initial.body.setup.guest, true);
assert.equal(initial.body.user, null);
passed("首次访问返回访客模式，不要求账号");
assert.equal((await call("/api/projects")).status, 401);
passed("未持有会话不能直接读取项目");
const a = await call("/api/auth/guest", "POST");
assert.equal(a.status, 200);
assert.ok(
  a.cookies.some((v) => /HttpOnly/i.test(v) && /SameSite=lax/i.test(v)),
);
const cookieA = a.cookies[0].split(";")[0];
assert.equal(a.body.token, undefined);
passed("建立真实匿名会话，Cookie 标记 HttpOnly/SameSite，响应无令牌");
const resume = await call("/api/session", "GET", cookieA);
assert.equal(resume.body.user.id, a.body.user.id);
passed("再次访问恢复同一访客");
const reuse = await call("/api/auth/guest", "POST", cookieA);
assert.equal(reuse.body.user.id, a.body.user.id);
passed("重复初始化复用同一访客");
assert.equal((await call("/api/projects", "GET", cookieA)).status, 200);
passed("访客可读取自己的项目列表");
const b = await call("/api/auth/guest", "POST");
assert.equal(b.status, 200);
assert.notEqual(b.body.user.id, a.body.user.id);
passed("独立浏览器身份获得不同访客");
assert.equal(
  (
    await call(
      "/api/auth/guest",
      "POST",
      "",
      undefined,
      "https://outside.invalid",
    )
  ).status,
  403,
);
passed("跨站建立访客会话被拒绝");
const invalid = await call(
  "/api/session",
  "GET",
  "xiaoyan_local_session=invalid",
);
assert.equal(invalid.body.user, null);
passed("伪造会话无效");
if (!initial.body.setup.model) {
  const generated = await call("/api/generate", "POST", cookieA, {
    requestId: randomUUID(),
    projectId: randomUUID(),
    revision: 0,
    prompt: "创建一个待办清单",
  });
  assert.equal(generated.status, 503);
  assert.equal(generated.body.code, "SETUP_REQUIRED");
  passed("访客身份正常时仍明确拒绝未配置模型的生成，不产生假成功");
}
await call("/api/auth/logout", "POST", cookieA);
assert.equal((await call("/api/projects", "GET", cookieA)).status, 401);
passed("撤销后旧会话不能访问项目");
const replacement = await call("/api/auth/guest", "POST", cookieA);
assert.notEqual(replacement.body.user.id, a.body.user.id);
passed("失效会话可建立新访客，不接管原身份");
await call("/api/auth/logout", "POST", b.cookies[0].split(";")[0]);
await call("/api/auth/logout", "POST", replacement.cookies[0].split(";")[0]);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = `E:/test/testing/guest-${stamp}`;
await mkdir(directory, { recursive: true });
const report = {
  date: new Date().toISOString(),
  environment: "真实本机 HTTP + 落盘数据库，无模拟模型",
  checks,
  modelCalls: 0,
  realGeneration: initial.body.setup.model ? "未执行" : "阻塞：缺少模型配置",
};
await writeFile(
  `${directory}/guest-smoke.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, evidence: directory }, null, 2));
