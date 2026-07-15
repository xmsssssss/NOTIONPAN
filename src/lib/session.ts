import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { getRuntimeEnv, ensureRuntimeEnvLoaded } from "./runtime-env";

export type SessionData = {
  isLoggedIn: boolean;
  username: string;
};

function sessionPassword(): string {
  ensureRuntimeEnvLoaded();
  const secret = getRuntimeEnv("SESSION_SECRET");
  if (secret && secret.length >= 32) return secret;
  // 生产务必配置 SESSION_SECRET；此处仅作兜底，保证 seal/unseal 一致
  return "notionpan-dev-session-secret-change-me-32b";
}

/**
 * Cookie Secure 策略：
 * - COOKIE_SECURE=1/true  → 仅 HTTPS
 * - COOKIE_SECURE=0/false → HTTP 也可用（公网 IP / 内网 IP 常用）
 * - 未设置：默认 false（自托管网盘多为 IP:端口 HTTP，避免 production 下登不进）
 *   上线 HTTPS 后请设 COOKIE_SECURE=1
 */
function cookieSecure(): boolean {
  ensureRuntimeEnvLoaded();
  const secureEnv =
    getRuntimeEnv("COOKIE_SECURE") ??
    getRuntimeEnv("SESSION_COOKIE_SECURE") ??
    process.env.COOKIE_SECURE ??
    process.env.SESSION_COOKIE_SECURE;

  if (secureEnv === "1" || secureEnv === "true") return true;
  if (secureEnv === "0" || secureEnv === "false") return false;
  return false;
}

export function getSessionOptions(): SessionOptions {
  return {
    password: sessionPassword(),
    cookieName: "notionpan_session",
    cookieOptions: {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: "lax",
      path: "/",
      // 30 天
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

export async function requireSession() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    throw new AuthError("未登录");
  }
  return session;
}

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
