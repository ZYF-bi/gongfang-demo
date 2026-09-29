import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  guest: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: stubs.get, set: stubs.set }),
}));
vi.mock("@/lib/local-db", async (original) => ({
  ...(await original<typeof import("@/lib/local-db")>()),
  localGuestSession: stubs.guest,
}));
import { POST } from "@/app/api/auth/[action]/route";
const request = (origin = "http://127.0.0.1:3000") =>
  new Request(`${origin}/api/auth/guest`, {
    method: "POST",
    headers: { origin },
  });
const context = { params: Promise.resolve({ action: "guest" }) };
describe("guest initialization HTTP protections (mock cookie jar and identity allocation)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH_BACKEND", "local");
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
    vi.stubEnv("LOCAL_ACCESS_MODE", "guest");
    stubs.guest.mockResolvedValue({
      user: { id: "guest-id", email: "guest@local.invalid" },
      token: "test-token",
      seconds: 31536000,
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("sets a private cookie and keeps its token out of JSON", async () => {
    stubs.get.mockReturnValue({ value: "previous-token" });
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(stubs.guest).toHaveBeenCalledWith("previous-token");
    expect(stubs.set).toHaveBeenCalledWith(
      "xiaoyan_local_session",
      "test-token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 31536000,
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("test-token");
  });
  it("rejects cross-origin initialization before allocating an identity", async () => {
    expect(
      (await POST(request("https://outside.invalid"), context)).status,
    ).toBe(403);
    expect(stubs.guest).not.toHaveBeenCalled();
  });
  it("does not enable guests in explicit account mode", async () => {
    vi.stubEnv("LOCAL_ACCESS_MODE", "account");
    expect((await POST(request(), context)).status).toBe(404);
    expect(stubs.guest).not.toHaveBeenCalled();
  });
  it("does not expose local guest mode on a public deployment", async () => {
    vi.stubEnv("APP_ORIGIN", "https://demo.example.com");
    expect(
      (await POST(request("https://demo.example.com"), context)).status,
    ).toBe(503);
    expect(stubs.guest).not.toHaveBeenCalled();
  });
});
