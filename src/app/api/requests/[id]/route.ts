import { authenticated, json, route } from "@/lib/server";
import { AppError } from "@/lib/errors";
import { getProject, getRequest } from "@/lib/projects";
import { projectIdSchema } from "@/lib/validation";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const { db } = await authenticated();
    const { id } = await context.params;
    if (!projectIdSchema.safeParse(id).success)
      throw new AppError("NOT_FOUND", "操作不存在", 404);
    const data = await getRequest(db, id);
    if (!data) return json({ status: "not_found" });
    if (data.status === "succeeded")
      return json({
        status: "succeeded",
        project: await getProject(db, data.project_id),
      });
    const expired =
      data.status === "running" &&
      Date.now() - Date.parse(data.created_at) > 150_000;
    return json({
      status: expired ? "expired" : data.status,
      code: data.error_code,
    });
  });
}
