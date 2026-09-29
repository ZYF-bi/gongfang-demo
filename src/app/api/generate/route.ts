import { createHash } from "node:crypto";
import {
  authenticated,
  checkOrigin,
  configured,
  json,
  readJson,
  route,
} from "@/lib/server";
import { generateSchema } from "@/lib/validation";
import { AppError } from "@/lib/errors";
import {
  finish,
  getProject,
  beginGeneration,
  markGeneration,
} from "@/lib/projects";
import { generateHtml } from "@/lib/model";
import type { Candidate } from "@/lib/types";

export const maxDuration = 90;
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { db } = await authenticated();
    const input = await readJson(request, generateSchema, 16000);
    if (!configured().model)
      throw new AppError("SETUP_REQUIRED", "模型服务尚未配置", 503);
    const project =
      input.revision > 0 ? await getProject(db, input.projectId) : undefined;
    if (project && project.revision !== input.revision)
      throw new AppError("CONFLICT", "项目已更新，请重新打开", 409);
    if (
      project &&
      [...JSON.stringify(project.applied_changes)].length +
        [...input.prompt].length >
        10000
    )
      throw new AppError(
        "HISTORY_LIMIT",
        "补充要求累计超过上限，请新建项目后继续",
        400,
      );
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const admission = await beginGeneration(db, input, fingerprint);
    if (!admission.created) {
      if (admission.status === "succeeded")
        return json({
          saved: true,
          requestId: input.requestId,
          project: await getProject(db, input.projectId),
        });
      throw new AppError(
        "REQUEST_EXISTS",
        "该请求已经处理或仍在处理中，请检查操作状态，不会重复调用模型",
        409,
      );
    }
    async function mark(status: string, code?: string, usage?: unknown) {
      try {
        await markGeneration(db, input.requestId, status, code, usage);
      } catch {
        /* Tracking failure must not discard an already generated result. */
      }
    }
    let generated;
    try {
      generated = await generateHtml(input.prompt, project);
    } catch (error) {
      await mark(
        "failed",
        error instanceof AppError ? error.code : "MODEL_ERROR",
      );
      throw error;
    }
    await mark("running", undefined, generated.usage);
    const candidate: Candidate = {
      id: input.projectId,
      name: project?.name ?? [...input.prompt].slice(0, 20).join(""),
      original_prompt: project?.original_prompt ?? input.prompt,
      applied_changes: [
        ...(project?.applied_changes ?? []),
        ...(project ? [input.prompt] : []),
      ],
      html: generated.html,
    };
    try {
      return json({
        saved: true,
        requestId: input.requestId,
        project: await finish(db, input.requestId, generated.html),
      });
    } catch (error) {
      await mark(
        "unsaved",
        error instanceof AppError ? error.code : "SAVE_FAILED",
        generated.usage,
      );
      return json({
        saved: false,
        requestId: input.requestId,
        candidate,
        code: error instanceof AppError ? error.code : "SAVE_FAILED",
        message:
          error instanceof AppError ? error.message : "保存失败，请重试保存",
      });
    }
  });
}
