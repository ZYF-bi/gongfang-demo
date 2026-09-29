import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateHtml } from "@/lib/model";
describe("model transport", () => {
  beforeEach(() => {
    vi.stubEnv("MODEL_API_KEY", "test-only-key");
    vi.stubEnv("MODEL_NAME", "fixture");
    vi.stubEnv("MODEL_API_BASE_URL", "https://model.invalid/v1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("does not retry a provider failure or expose provider response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("private provider response", { status: 500 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateHtml("todo")).rejects.toMatchObject({
      code: "MODEL_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated output even if it looks like HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [
            {
              finish_reason: "length",
              message: { content: "<html><body>ok</body></html>" },
            },
          ],
        }),
      ),
    );
    await expect(generateHtml("todo")).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
  });
  it("aborts the upstream call at its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      ),
    );
    const result = generateHtml("todo");
    const assertion = expect(result).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(75_000);
    await assertion;
  });
  it("returns usable code and provider token usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "<html><body><button>ok</button></body></html>",
              },
            },
          ],
          usage: { total_tokens: 12, prompt_tokens: 5, completion_tokens: 7 },
        }),
      ),
    );
    const result = await generateHtml("todo");
    expect(result.usage?.total_tokens).toBe(12);
    expect(result.html).toContain("<button>");
  });
});
