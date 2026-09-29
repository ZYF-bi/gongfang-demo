import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, databaseError } from "./errors";
import type { Project, ProjectSummary } from "./types";
import { localQuery, type LocalDatabase } from "./local-db";
export type Database = SupabaseClient | LocalDatabase;
const isLocal = (db: Database): db is LocalDatabase =>
  "kind" in db && db.kind === "local";

export const projectColumns =
  "id,name,original_prompt,applied_changes,html,revision,created_at,updated_at";
export async function getProject(db: Database, id: string): Promise<Project> {
  if (isLocal(db)) {
    const rows = await localQuery<Project>(
      db.userId,
      `select ${projectColumns} from public.projects where id=$1`,
      [id],
    );
    if (!rows[0])
      throw new AppError("NOT_FOUND", "项目不存在或无访问权限", 404);
    return JSON.parse(JSON.stringify(rows[0]));
  }
  const { data, error } = await db
    .from("projects")
    .select(projectColumns)
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseError(error.message);
  if (!data) throw new AppError("NOT_FOUND", "项目不存在或无访问权限", 404);
  return data as Project;
}
export async function finish(
  db: Database,
  requestId: string,
  html: string,
): Promise<Project> {
  if (isLocal(db))
    return localRpc<Project>(db, "finish_generation", [requestId, html]);
  const { data, error } = await db.rpc("finish_generation", {
    p_request_id: requestId,
    p_html: html,
  });
  if (error) throw databaseError(error.message);
  return data as Project;
}

async function localRpc<T>(
  db: LocalDatabase,
  name: string,
  args: unknown[],
): Promise<T> {
  if (
    !["begin_generation", "finish_generation", "mark_generation"].includes(name)
  )
    throw new Error("Unsupported operation");
  try {
    const rows = await localQuery<{ value: T }>(
      db.userId,
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
      args,
    );
    return JSON.parse(JSON.stringify(rows[0].value));
  } catch (error) {
    throw databaseError(
      error instanceof Error ? error.message : "DATABASE_ERROR",
    );
  }
}
export async function beginGeneration(
  db: Database,
  input: {
    requestId: string;
    projectId: string;
    revision: number;
    prompt: string;
  },
  fingerprint: string,
) {
  if (isLocal(db))
    return localRpc<{ created: boolean; status: string }>(
      db,
      "begin_generation",
      [
        input.requestId,
        input.projectId,
        input.revision,
        input.prompt,
        fingerprint,
      ],
    );
  const { data, error } = await db.rpc("begin_generation", {
    p_request_id: input.requestId,
    p_project_id: input.projectId,
    p_revision: input.revision,
    p_prompt: input.prompt,
    p_fingerprint: fingerprint,
  });
  if (error) throw databaseError(error.message);
  return data as { created: boolean; status: string };
}
export async function markGeneration(
  db: Database,
  requestId: string,
  status: string,
  code?: string,
  usage?: unknown,
) {
  if (isLocal(db))
    return localRpc<null>(db, "mark_generation", [
      requestId,
      status,
      code ?? null,
      usage ?? null,
    ]);
  const { error } = await db.rpc("mark_generation", {
    p_request_id: requestId,
    p_status: status,
    p_error_code: code ?? null,
    p_usage: usage ?? null,
  });
  if (error) throw databaseError(error.message);
}
export async function listProjects(db: Database): Promise<ProjectSummary[]> {
  if (isLocal(db))
    return JSON.parse(
      JSON.stringify(
        await localQuery<ProjectSummary>(
          db.userId,
          "select id,name,updated_at,revision from public.projects order by updated_at desc limit 100",
        ),
      ),
    );
  const { data, error } = await db
    .from("projects")
    .select("id,name,updated_at,revision")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw databaseError(error.message);
  return data as ProjectSummary[];
}
type RequestRecord = {
  project_id: string;
  status: string;
  created_at: string;
  error_code: string | null;
};
export async function getRequest(
  db: Database,
  id: string,
): Promise<RequestRecord | null> {
  if (isLocal(db)) {
    const rows = await localQuery<RequestRecord>(
      db.userId,
      "select project_id,status,created_at,error_code from public.generation_requests where request_id=$1",
      [id],
    );
    return rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null;
  }
  const { data, error } = await db
    .from("generation_requests")
    .select("project_id,status,created_at,error_code")
    .eq("request_id", id)
    .maybeSingle();
  if (error) throw databaseError(error.message);
  return data as RequestRecord | null;
}
