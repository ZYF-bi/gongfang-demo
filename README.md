# 小验工坊 Atoms Demo

此仓库使用 2026-09-29 第二次更新的 github.zip 新版代码。应用源码以最新导出包为准，历史提交仍可查阅。

## 目录

- `app/frontend`：React、Vite、TypeScript 前端。
- `app/backend`：Python / FastAPI 后端，包含数据库迁移、认证、项目和模型接口。
- `app/start_app_v2.sh`：Atoms 导出的启动脚本，需要兼容的 shell 和平台运行环境。
- `app/项目介绍.md`：导出包提供的项目说明，其中的功能声明需以实际运行结果为准。

## 运行与验证边界

前端在 `app/frontend` 中执行 `pnpm install --frozen-lockfile`，再执行 `pnpm build` 或 `pnpm dev`。
后端依赖见 `app/backend/requirements.txt` 及 `requirements.default`，启动与平台配置见导出的脚本和源码。
此项目依赖 Atoms 认证、AI 服务及数据库配置，源码同步成功不代表在本机或其他托管平台自动可用。不得把平台凭据写入公开仓库。

本次同步保留应用源码，排除运行日志、构建产物、上传截图及平台内部过程文档。原始压缩包保持不变。
旧版的 42 项自动化测试和 12 项接口冒烟结果不能作为新版通过的证据。新版验证以本次同步记录和后续实测为准。
