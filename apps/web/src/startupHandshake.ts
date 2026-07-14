export function resolveStartupSessionUrl(apiBaseUrl: string): string {
  const base = new URL(apiBaseUrl);
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1") {
    throw new Error("本地服务握手地址必须使用 127.0.0.1 HTTP 回环地址");
  }
  if (base.username || base.password) {
    throw new Error("本地服务握手地址不得包含凭据");
  }
  return new URL("/api/v1/session", base.origin).toString();
}
