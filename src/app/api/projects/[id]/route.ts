import {
  authenticated,
  checkOrigin,
  json,
  readJson,
  route,
} from "@/lib/server";
import { getProject, finish, getRequest } from "@/lib/projects";
import { projectIdSchema, saveSchema } from "@/lib/validation";
import { AppError } from "@/lib/errors";
import { validateHtml } from "@/lib/preview";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const { db } = await authenticated();
    const { id } = await context.params;
    if (!projectIdSchema.safeParse(id).success)
      throw new AppError("NOT_FOUND", "项目不存在", 404);
    return json({ project: await getProject(db, id) });
  });
}
export async function PUT(request: Request, context: Context) {
  return route(async () => {
    checkOrigin(request);
    const { db } = await authenticated();
    const { id } = await context.params;
    const input = await readJson(request, saveSchema, 1_250_000);
    const data = await getRequest(db, input.requestId);
    if (!data || data.project_id !== id)
      throw new AppError("NOT_FOUND", "操作不存在", 404);
    return json({
      project: await finish(db, input.requestId, validateHtml(input.html)),
    });
  });
}
