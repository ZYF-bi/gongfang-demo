import { authenticated, json, route } from "@/lib/server";
import { listProjects } from "@/lib/projects";
export async function GET() {
  return route(async () => {
    const { db } = await authenticated();
    return json({ projects: await listProjects(db) });
  });
}
