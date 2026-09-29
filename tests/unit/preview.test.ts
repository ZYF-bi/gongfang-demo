import { describe, expect, it } from "vitest";
import { buildPreview, previewMessage, validateHtml } from "@/lib/preview";
const html =
  "<!DOCTYPE html><html><head><title>test</title></head><body><button>ok</button></body></html>";
describe("preview envelope", () => {
  it("rejects empty, truncated and external dependency output", () => {
    for (const bad of [
      "",
      "<div>not complete</div>",
      html.replace("</html>", ""),
      html.replace(
        "</head>",
        '<script src="https://example.com/x.js"></script></head>',
      ),
    ])
      expect(() => validateHtml(bad)).toThrow();
  });
  it("unwraps fenced output and accepts full documents", () => {
    expect(validateHtml("```html\n" + html + "\n```")).toBe(html);
  });
  it("puts fixed CSP ahead of generated content and removes navigation resources", () => {
    const result = buildPreview(
      html
        .replace(
          "</head>",
          '<base href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com"></head>',
        )
        .replace(
          "</body>",
          '<iframe src="https://example.com"></iframe><a href="https://example.com" target="_top">link</a></body>',
        ),
      "test-channel",
    );
    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(
      result.indexOf("<title>"),
    );
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("<base");
    expect(result).not.toContain('http-equiv="refresh"');
    expect(result).not.toContain('href="https:');
    expect(result).not.toContain('target="_top"');
    expect(result).toContain("connect-src 'none'");
  });
  it("rejects unrelated or unbounded preview messages", () => {
    expect(
      previewMessage(
        { type: "preview-error", channel: "wrong", message: "bad" },
        "correct",
      ),
    ).toBeNull();
    expect(
      previewMessage(
        { type: "preview-error", channel: "correct", message: "x".repeat(500) },
        "correct",
      ),
    ).toHaveLength(300);
    expect(previewMessage(null, "correct")).toBeNull();
  });
});
