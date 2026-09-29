import { describe, expect, it } from "vitest";
import {
  generateSchema,
  length,
  registerSchema,
  saveSchema,
} from "@/lib/validation";
const credentials = {
  email: "test@example.com",
  password: "test1234",
  confirmPassword: "test1234",
};
describe("input boundaries", () => {
  it("trims email without trimming passwords", () => {
    expect(
      registerSchema.parse({
        ...credentials,
        email: " test@example.com ",
        password: " ab12345 ",
        confirmPassword: " ab12345 ",
      }).password,
    ).toBe(" ab12345 ");
  });
  it.each(["12345678", "abcdefgh", "abc1234", "a1".repeat(33)])(
    "rejects invalid password %s",
    (password) => {
      expect(
        registerSchema.safeParse({
          ...credentials,
          password,
          confirmPassword: password,
        }).success,
      ).toBe(false);
    },
  );
  it.each(["abc12345", "a1".repeat(32)])(
    "accepts password boundary",
    (password) => {
      expect(
        registerSchema.safeParse({
          ...credentials,
          password,
          confirmPassword: password,
        }).success,
      ).toBe(true);
    },
  );
  it("rejects confirmation mismatch and invalid email", () => {
    expect(
      registerSchema.safeParse({ ...credentials, confirmPassword: "other123" })
        .success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...credentials, email: "invalid" }).success,
    ).toBe(false);
  });
  it("counts Unicode code points consistently", () => {
    const input = {
      requestId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      revision: 0,
    };
    expect(length("你😀")).toBe(2);
    expect(
      generateSchema.safeParse({ ...input, prompt: "😀".repeat(2000) }).success,
    ).toBe(true);
    expect(
      generateSchema.safeParse({ ...input, prompt: "😀".repeat(2001) }).success,
    ).toBe(false);
    expect(generateSchema.safeParse({ ...input, prompt: "   " }).success).toBe(
      false,
    );
  });
  it("limits code by bytes rather than string length", () => {
    expect(
      saveSchema.safeParse({
        requestId: credentials.email,
        html: "<html></html>",
      }).success,
    ).toBe(false);
    expect(
      saveSchema.safeParse({
        requestId: "11111111-1111-4111-8111-111111111111",
        html: "中".repeat(70000),
      }).success,
    ).toBe(false);
  });
});
