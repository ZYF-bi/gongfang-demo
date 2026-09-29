import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
const stubs = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn(),
  model: vi.fn(),
  getProject: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@/lib/server", async (original) => ({
  ...(await original<typeof import("@/lib/server")>()),
  authenticated: stubs.auth,
  configured: () => ({ auth: true, model: true }),
}));
vi.mock("@/lib/model", () => ({ generateHtml: stubs.model }));
vi.mock("@/lib/projects", async (original) => ({
  ...(await original<typeof import("@/lib/projects")>()),
  getProject: stubs.getProject,
  finish: stubs.finish,
}));
import { POST } from "@/app/api/generate/route";
const input = {
  requestId: "33333333-3333-4333-8333-333333333333",
  projectId: "11111111-1111-4111-8111-111111111111",
  revision: 0,
  prompt: "make todo",
};
const html = "<html><body>todo</body></html>";
const request = (body: unknown = input, origin = "http://127.0.0.1:3000") =>
  new Request("http://127.0.0.1:3000/api/generate", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("generation HTTP orchestration (mock external dependencies)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.APP_ORIGIN = "http://127.0.0.1:3000";
    stubs.auth.mockResolvedValue({
      db: { rpc: stubs.rpc },
      user: { id: "owner" },
    });
    stubs.rpc.mockResolvedValue({ data: { created: true }, error: null });
    stubs.model.mockResolvedValue({ html, usage: null });
    stubs.finish.mockResolvedValue({ id: input.projectId, html, revision: 1 });
  });
  it("rejects unauthenticated callers before any paid call", async () => {
    stubs.auth.mockRejectedValue(new AppError("UNAUTHORIZED", "login", 401));
    expect((await POST(request())).status).toBe(401);
    expect(stubs.model).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes", async () => {
    expect((await POST(request(input, "https://evil.invalid"))).status).toBe(
      403,
    );
    expect(stubs.auth).not.toHaveBeenCalled();
  });
  it("rejects oversized prompts before reserving a request", async () => {
    expect(
      (await POST(request({ ...input, prompt: "a".repeat(2001) }))).status,
    ).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("prevents stale revision from triggering a model call", async () => {
    stubs.getProject.mockResolvedValue({ revision: 2, applied_changes: [] });
    expect((await POST(request({ ...input, revision: 1 }))).status).toBe(409);
    expect(stubs.model).not.toHaveBeenCalled();
  });
  it("does not regenerate a duplicate running request", async () => {
    stubs.rpc.mockResolvedValue({
      data: { created: false, status: "running" },
      error: null,
    });
    expect((await POST(request())).status).toBe(409);
    expect(stubs.model).not.toHaveBeenCalled();
  });
  it("records provider failure and leaves the saved project untouched", async () => {
    stubs.model.mockRejectedValue(
      new AppError("MODEL_TIMEOUT", "timeout", 504),
    );
    expect((await POST(request())).status).toBe(504);
    expect(stubs.finish).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledWith(
      "mark_generation",
      expect.objectContaining({
        p_status: "failed",
        p_error_code: "MODEL_TIMEOUT",
      }),
    );
  });
  it("returns the generated candidate when saving fails, even if recording that failure also fails", async () => {
    stubs.finish.mockRejectedValue(
      new AppError("DATABASE_ERROR", "save unavailable", 503),
    );
    stubs.rpc.mockImplementation((name: string) =>
      name === "begin_generation"
        ? Promise.resolve({ data: { created: true }, error: null })
        : Promise.reject(new Error("offline")),
    );
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.saved).toBe(false);
    expect(body.candidate.html).toBe(html);
    expect(stubs.model).toHaveBeenCalledTimes(1);
  });
  it("reports success only after save succeeds", async () => {
    const response = await POST(request());
    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(stubs.finish).toHaveBeenCalledWith(
      expect.anything(),
      input.requestId,
      html,
    );
  });
});
