import { AppError } from "./errors";
import { validateHtml } from "./preview";
import type { Project } from "./types";

const SYSTEM = `你是一个单页网页应用开发智能体。将用户需求实现为可直接运行的中文网页。
仅返回完整 HTML，从 <!DOCTYPE html> 到 </html>，不要 Markdown 或解释。
CSS 和 JavaScript 必须内联。禁止外部脚本、外部字体、外部图片、网络请求、iframe、跳转、下载和第三方服务。
运行环境是仅允许脚本的 sandbox iframe，不允许访问父页面、Cookie、localStorage、sessionStorage、indexedDB。应用内数据只在内存中保存。
实现真实交互、清晰布局、输入校验和错误提示；不要使用占位按钮。用浏览器原生能力实现，不使用框架依赖。
如果需求超出单页本地工具范围，制作明确说明限制的页面，不假装已连接后台。修改时保留仍被需要的原功能。`;

export async function generateHtml(prompt: string, project?: Project) {
  const key = process.env.MODEL_API_KEY;
  const name = process.env.MODEL_NAME;
  const base = process.env.MODEL_API_BASE_URL;
  if (!key || !name || !base)
    throw new AppError(
      "SETUP_REQUIRED",
      "模型服务尚未配置，请按 README 填写模型配置",
      503,
    );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75_000);
  try {
    const user = project
      ? `原始需求：${project.original_prompt}\n已应用修改：${JSON.stringify(project.applied_changes)}\n当前代码：\n${project.html}\n本次修改：${prompt}`
      : prompt;
    const response = await fetch(
      `${base.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: name,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: user },
          ],
          max_tokens: 12000,
          ...(new URL(base).hostname === "api.deepseek.com"
            ? { thinking: { type: "disabled" } }
            : {}),
        }),
      },
    );
    if (!response.ok)
      throw new AppError(
        "MODEL_ERROR",
        response.status === 429
          ? "模型服务繁忙或额度不足，请稍后重试"
          : "模型服务调用失败，请稍后重试",
        502,
      );
    const body = await response.json();
    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length")
      throw new AppError(
        "INVALID_OUTPUT",
        "生成代码被截断，请缩小需求后重试",
        502,
      );
    if (typeof choice?.message?.content !== "string")
      throw new AppError("INVALID_OUTPUT", "模型没有返回可用网页，请重试", 502);
    return {
      html: validateHtml(choice.message.content),
      usage: body.usage
        ? {
            prompt_tokens: Number(body.usage.prompt_tokens) || 0,
            completion_tokens: Number(body.usage.completion_tokens) || 0,
            total_tokens: Number(body.usage.total_tokens) || 0,
            model: name,
          }
        : null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted)
      throw new AppError(
        "MODEL_TIMEOUT",
        "生成超时，请检查项目状态后手动重试",
        504,
      );
    throw new AppError("MODEL_ERROR", "无法连接模型服务，请稍后重试", 502);
  } finally {
    clearTimeout(timer);
  }
}
