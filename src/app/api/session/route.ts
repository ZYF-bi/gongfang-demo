import { authenticated, configured, json, route } from "@/lib/server";
import { AppError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export async function GET() {
  return route(async () => {
    const setup = configured();
    if (!setup.auth) return json({ user: null, setup });
    try {
      const { user } = await authenticated();
      return json({ user: { id: user.id, email: user.email }, setup });
    } catch (error) {
      if (error instanceof AppError && error.status === 401)
        return json({ user: null, setup });
      throw error;
    }
  });
}
