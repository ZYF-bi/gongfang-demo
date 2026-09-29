// Production smoke check for a clean installation WITHOUT cloud credentials.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:3000';
const checks = [];
const homepage = await fetch(origin);
assert.equal(homepage.status, 200);
assert.match(homepage.headers.get('content-security-policy'), /frame-src 'self'/);
checks.push('生产首页返回 200，包含预览导航限制响应头');
const session = await (await fetch(`${origin}/api/session`)).json();
assert.deepEqual(session, { user: null, setup: { auth: false, model: false } });
checks.push('真实服务接口准确返回未配置状态，没有伪造登录');
const foreign = await fetch(`${origin}/api/generate`, { method: 'POST', headers: { origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(foreign.status, 403);
checks.push('拒绝其他站点发起的写请求');
const generate = await fetch(`${origin}/api/generate`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(generate.status, 503);
assert.equal((await generate.json()).code, 'SETUP_REQUIRED');
checks.push('缺少配置时拒绝生成，没有伪造应用或调用外部模型');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('heading', { name: '欢迎回到工坊' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '进入工坊' }).isDisabled(), true);
  assert.equal(await page.getByRole('status').filter({ hasText: '账号服务尚未配置' }).count(), 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'docs/screenshots/production-unconfigured.png', fullPage: true });
  checks.push('真实 Chrome 显示配置提示并禁用登录入口，无页面 JavaScript 错误');
} finally { await browser.close(); }
const result = { date: new Date().toISOString(), environment: '本机生产构建，无云端配置，未模拟 HTTP 响应', checks, status: 'passed' };
await writeFile('E:/test/testing/20260924-final-v2/production-smoke.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
