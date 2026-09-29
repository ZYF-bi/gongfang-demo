import { expect, test, type Page } from "@playwright/test";
import type { Project } from "../../src/lib/types";
const ID = "11111111-1111-4111-8111-111111111111";
const USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "tester@example.com",
};
const HTML = `<!DOCTYPE html><html><head><title>待办</title><style>body{font:16px Arial;padding:35px;color:#284335}button{padding:8px;background:#dfe9d9;border:0;border-radius:5px}input{padding:8px}</style></head><body><h1>今日待办</h1><input aria-label="新事项"><button id="add">添加</button><p id="tip"></p><ul></ul><script>document.querySelector('#add').onclick=()=>{const input=document.querySelector('input');if(!input.value.trim()){document.querySelector('#tip').textContent='请输入事项';return;}const li=document.createElement('li');li.textContent=input.value;const b=document.createElement('button');b.textContent='删除';b.onclick=()=>li.remove();li.appendChild(b);document.querySelector('ul').appendChild(li);input.value='';};</script></body></html>`;
const saved: Project = {
  id: ID,
  name: "待办清单",
  original_prompt: "制作待办清单",
  applied_changes: [],
  html: HTML,
  revision: 1,
  created_at: "2026-09-24T00:00:00Z",
  updated_at: "2026-09-24T00:00:00Z",
};
type Fixture = {
  loggedIn: boolean;
  project: Project | null;
  calls: number;
  mode: "success" | "failure" | "unsaved" | "unknown";
  responseDelay: number;
};

async function fixture(page: Page, overrides: Partial<Fixture> = {}) {
  const state: Fixture = {
    loggedIn: true,
    project: null,
    calls: 0,
    mode: "success",
    responseDelay: 0,
    ...overrides,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        user: state.loggedIn ? USER : null,
        setup: { auth: true, model: true },
      });
    if (path === "/api/auth/register" || path === "/api/auth/login") {
      state.loggedIn = true;
      return reply({ user: USER });
    }
    if (path === "/api/auth/logout") {
      state.loggedIn = false;
      return reply({ ok: true });
    }
    if (path === "/api/projects")
      return reply({ projects: state.project ? [state.project] : [] });
    if (path.startsWith("/api/projects/") && request.method() === "GET")
      return reply({ project: state.project });
    if (path.startsWith("/api/projects/") && request.method() === "PUT") {
      state.project = { ...saved, id: path.split("/").pop()! };
      return reply({ project: state.project });
    }
    if (path.startsWith("/api/requests/"))
      return reply({ status: "succeeded", project: state.project ?? saved });
    if (path === "/api/generate") {
      state.calls++;
      const input = request.postDataJSON();
      if (state.responseDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, state.responseDelay),
        );
      if (state.mode === "failure")
        return reply(
          { code: "MODEL_ERROR", message: "模型服务调用失败，请稍后重试" },
          502,
        );
      if (state.mode === "unknown") return route.abort("failed");
      const output = {
        ...saved,
        id: input.projectId,
        revision: input.revision + 1,
        applied_changes: input.revision > 0 ? [input.prompt] : [],
      };
      if (state.mode === "unsaved")
        return reply({
          saved: false,
          requestId: input.requestId,
          candidate: output,
          message: "数据服务暂不可用",
        });
      state.project = output;
      return reply({
        saved: true,
        requestId: input.requestId,
        project: output,
      });
    }
    return reply({ message: "unexpected fixture request" }, 500);
  });
  return state;
}

test("register validation, login, generate, operate, modify and reopen (mock services)", async ({
  page,
}) => {
  const state = await fixture(page, { loggedIn: false });
  await page.goto("/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("tester@example.com");
  await page.getByLabel("密码", { exact: true }).fill("test1234");
  await page.getByLabel("确认密码", { exact: true }).fill("mismatch");
  await page.getByRole("button", { name: "创建账号并开始" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "两次密码不一致" }),
  ).toBeVisible();
  await page.getByLabel("确认密码", { exact: true }).fill("test1234");
  await page.getByRole("button", { name: "创建账号并开始" }).click();
  await expect(
    page.getByRole("heading", { name: "今天，想做点什么？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "待办清单", exact: true }).click();
  await page.getByRole("button", { name: "生成应用", exact: true }).click();
  await expect(page.getByText("生成完成，项目已保存")).toBeVisible();
  const preview = page.frameLocator("iframe");
  await preview.getByLabel("新事项").fill("准备面试");
  await preview.getByRole("button", { name: "添加", exact: true }).click();
  await expect(preview.locator("li")).toContainText("准备面试");
  await page.getByRole("tab", { name: "查看代码" }).click();
  await page.getByRole("tab", { name: "应用预览" }).click();
  await expect(preview.locator("li")).toContainText("准备面试");
  await preview.getByRole("button", { name: "删除", exact: true }).click();
  await expect(preview.locator("li")).toHaveCount(0);
  await page.getByLabel("这次想改些什么？").fill("增加筛选");
  await page.getByRole("button", { name: "根据要求修改" }).click();
  await expect(page.getByText("已应用 1 次补充要求")).toBeVisible();
  expect(state.calls).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: /待办清单.*2026/ }).click();
  await expect(page.getByText("已应用 1 次补充要求")).toBeVisible();
  await page.getByRole("tab", { name: "查看代码" }).click();
  await expect(page.getByLabel("生成的 HTML 代码")).toContainText("<html>");
});

test("prevents repeated submits and preserves old preview on model failure", async ({
  page,
}) => {
  const state = await fixture(page, {
    project: saved,
    responseDelay: 700,
    mode: "failure",
  });
  await page.goto("/");
  await page.getByRole("button", { name: /待办清单.*2026/ }).click();
  await page.getByLabel("这次想改些什么？").fill("增加筛选");
  await page.getByRole("button", { name: "根据要求修改" }).click();
  await expect(
    page.getByRole("button", { name: "正在修改应用" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "模型服务调用失败" }),
  ).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "今日待办" }),
  ).toBeVisible();
  await expect(page.getByLabel("这次想改些什么？")).toHaveValue("增加筛选");
  expect(state.calls).toBe(1);
});

test("save retry does not cause a second model call", async ({ page }) => {
  const state = await fixture(page, { mode: "unsaved" });
  await page.goto("/");
  await page.getByLabel("你希望应用可以做什么？").fill("制作待办清单");
  await page.getByRole("button", { name: "生成应用", exact: true }).click();
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试保存（不重新生成）" }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  expect(state.calls).toBe(1);
});

test("unknown network outcome requires status reconciliation, never automatic regeneration", async ({
  page,
}) => {
  const state = await fixture(page, { mode: "unknown" });
  await page.goto("/");
  await page.getByLabel("你希望应用可以做什么？").fill("制作待办清单");
  await page.getByRole("button", { name: "生成应用", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "检查操作状态" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成应用", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "检查操作状态" }).click();
  await expect(page.getByText("操作已完成，已恢复保存结果")).toBeVisible();
  expect(state.calls).toBe(1);
});

test("sandbox blocks parent storage, network access and forged outside messages", async ({
  page,
}) => {
  let leaks = 0;
  await page.route("https://blocked.example/**", async (route) => {
    leaks++;
    await route.abort();
  });
  const attack = `<html><head></head><body><h1 id="access">pending</h1><script>try{parent.localStorage.getItem('secret');document.querySelector('#access').textContent='LEAK'}catch{document.querySelector('#access').textContent='ISOLATED'}fetch('https://blocked.example/leak').catch(()=>{});</script></body></html>`;
  await fixture(page, { project: { ...saved, html: attack } });
  await page.goto("/");
  await page.getByRole("button", { name: /待办清单.*2026/ }).click();
  await expect(page.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "ISOLATED" }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.postMessage(
      { type: "preview-error", channel: "fake", message: "FORGED" },
      "*",
    ),
  );
  await expect(page.getByText("FORGED")).toHaveCount(0);
  expect(leaks).toBe(0);
});

test("logout removes prior account project content", async ({ page }) => {
  await fixture(page, { project: saved });
  await page.goto("/");
  await page.getByRole("button", { name: /待办清单.*2026/ }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到工坊" }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("desktop and mobile layouts remain usable (mock services)", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "今天，想做点什么？" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "生成应用", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/workspace-mobile.png",
    fullPage: true,
  });
});

test("login presentation screenshot (mock configuration, no real account)", async ({
  page,
}) => {
  await fixture(page, { loggedIn: false });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎回到工坊" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/login-desktop.png",
    fullPage: true,
  });
});
