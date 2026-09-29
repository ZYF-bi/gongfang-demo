# 小验工坊 Atoms Demo

自然语言描述需求，通过服务端模型接口生成单页 HTML，在隔离 iframe 中预览；支持查看代码、自动保存项目和补充要求修改。

## 历史验证记录（2026-09-24）

2026-09-24：本地 42 项自动化测试、12 项真实接口冒烟测试通过。模型 Key 已配置并可访问供应商只读接口；已执行一次真实生成调用，受账户余额不足影响未成功。真实生成成功后的修改与恢复以及公网端到端验收仍待完成。测试替身的结果不代表真实模型生成已经通过。

2026-09-29 整理上传副本：本次只检查导出文件与敏感配置，不代表重新完成业务测试；当前余额和云端运行情况需另外验证。

## 技术与范围

Next.js 15、React、TypeScript、PGlite、Supabase 适配、Chat Completions 兼容模型接口。本机默认免登录，每个浏览器由随机 Cookie 身份隔离数据。平台保存需求和代码；生成应用内部的待办等运行数据不承诺跨刷新保存。

## 本机运行

需要 Node.js 22+ 和 pnpm。解压后在项目根目录执行：

```sh
pnpm install --frozen-lockfile
node scripts/configure-local.mjs
pnpm dev
```

在本机 `.env.local` 私下填写真实 `MODEL_API_KEY`，确认供应商有可用余额，然后重启。默认模型地址为 `https://api.deepseek.com`，名称为 `deepseek-flash`。打开 `http://127.0.0.1:3000`，无需注册。`.env.example` 的值是示例，不是可用凭证。

项目数据落盘到 `.data/postgres`。同一目录不可同时启动两个服务进程。开发产物 `.next-dev` 与生产产物 `.next` 分开。

## 验证

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

最后一项需要已安装的 Chrome。历史浏览器用例使用模拟 API，主要验证界面及隔离预览，不能作为真实模型验收证据。真实 HTTP 冒烟脚本位于 `scripts/smoke-local-guest.mjs`，其中证据输出路径使用原开发机的 Windows 路径，异地运行时请先调整为本机可写路径。

## 使用

输入需求或选择示例 → 生成 → 操作预览/查看代码 → 补充要求 → 修改并保存 → 刷新后从列表重新打开。生成请求不自动重试；结果不确定时先检查操作状态；保存失败单独重试保存，不再次调用模型。

访客身份依赖同一浏览器 Cookie，一年后过期；清除 Cookie 或换浏览器无法恢复原访客项目。有效旧账号会话仍可复用，但沿用旧会话有效期。设置 `LOCAL_ACCESS_MODE=account` 并重启，可恢复本机账号入口。

## 公开部署

当前访客模式仅支持回环地址，不可直接公开部署。现有云端适配为 Supabase 账号模式，需要新建 Supabase 项目、执行 `supabase/migrations/202609240001_initial.sql`，设置 `AUTH_BACKEND=supabase`、Supabase URL/anon key、模型服务端变量及准确的 HTTPS `APP_ORIGIN`。不要使用 service_role key。若要公开免登录，需要继续实现和验收云端匿名身份方案。

应选择支持 Next.js 服务端及所需接口超时的托管平台，并设置模型预算。不能把 localhost 当在线交付地址。密码、Cookie、API Key 不进入代码、日志或公开材料。`.env.local`、`.data`、构建缓存、Git 历史及招聘题原文均未包含在此源码包中。

## 限制

不生成复杂后台、支付或第三方服务应用；未实现多智能体、代码历史回退或生成应用独立部署。预览使用 sandbox 与 CSP，但不能保证阻止所有运行错误或无限循环。最终功能必须以真实验收为准。
