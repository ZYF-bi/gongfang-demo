export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const databaseError = (message: string) => {
  const known: Record<string, [number, string]> = {
    RATE_LIMIT: [429, "本账号调用次数已达上限，请稍后再试"],
    BUSY: [409, "还有生成请求处理中，请稍后再试"],
    CONFLICT: [409, "项目已更新，请先重新打开项目"],
    NOT_FOUND: [404, "项目不存在或无访问权限"],
    REQUEST_CONFLICT: [409, "请求编号已被其他内容使用"],
    EXPIRED: [409, "本次操作已过期，请重新打开项目后重试"],
  };
  for (const [code, [status, text]] of Object.entries(known)) {
    if (message.includes(code)) return new AppError(code, text, status);
  }
  return new AppError("DATABASE_ERROR", "数据服务暂不可用，请稍后重试", 503);
};
