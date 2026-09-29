export class HttpError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  timeout = 15000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const body = await response.json();
    if (!response.ok)
      throw new HttpError(
        body.code || "HTTP_ERROR",
        body.message || "请求失败，请重试",
        response.status,
      );
    return body as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      "NETWORK_UNKNOWN",
      controller.signal.aborted
        ? "等待超时，请先检查操作状态"
        : "网络连接中断，请检查网络后重试",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}
