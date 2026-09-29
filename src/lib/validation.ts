import { z } from "zod";

export const MAX_HTML_BYTES = 200_000;
export const length = (s: string) => [...s].length;
const prompt = z
  .string()
  .trim()
  .min(1, "请输入有效需求")
  .refine((s) => length(s) <= 2000, "需求最多 2,000 字符");
const email = z.string().trim().email("请输入有效邮箱").max(254, "邮箱过长");
const password = z
  .string()
  .refine((s) => length(s) >= 8 && length(s) <= 64, "密码需要 8—64 个字符")
  .refine((s) => /[a-zA-Z]/.test(s) && /[0-9]/.test(s), "密码须包含字母和数字");
export const registerSchema = z
  .object({ email, password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: "两次密码不一致",
    path: ["confirmPassword"],
  });
export const loginSchema = z.object({
  email,
  password: z.string().min(1, "请输入密码").max(256),
});
export const generateSchema = z.object({
  requestId: z.string().uuid(),
  projectId: z.string().uuid(),
  prompt,
  revision: z.number().int().min(0),
});
export const saveSchema = z.object({
  requestId: z.string().uuid(),
  html: z
    .string()
    .min(1)
    .refine(
      (s) => new TextEncoder().encode(s).length <= MAX_HTML_BYTES,
      "代码超出大小限制",
    ),
});
export const projectIdSchema = z.string().uuid();
