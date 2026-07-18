import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { getPasswordVersion } from "./app-config";
import { getRuntimeEnv, ensureRuntimeEnvLoaded } from "./runtime-env";

export type SessionData = {
  isLoggedIn: boolean;
  username: string;
  /** 与 app-config 中密码版本对齐，改密后旧会话失效 */
  passwordVersion?: string;
};

const DEV_FALLBACK_FILE = ".session-secret";

function dataDir() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isProductionLike(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.DOCKER === "1" ||
    process.env.REQUIRE_SESSION_SECRET === "1"
  );
}

/** 开发环境：生成并持久化本地密钥，避免使用仓库内公开兜底串 */
function ensureDevSessionSecret(): string {
  const p = path.join(dataDir(), DEV_FALLBACK_FILE);
  try {
    if (fs.existsSync(p)) {
      const existing = fs.readFileSync(p, "utf8").trim();
      if (existing.length >= 32) return existing;
    }
  } catch {
    // ignore
  }
  const secret = crypto.randomBytes(32).toString("base64url");
  try {
    fs.writeFileSync(p, secret, "utf8");
  } catch {
    // 写失败仍返回本次随机值（进程内一致）
  }
  return secret;
}

function sessionPassword(): string {
  ensureRuntimeEnvLoaded();
  const secret = getRuntimeEnv("SESSION_SECRET");
  if (secret && secret.length >= 32) return secret;

  if (isProductionLike()) {
    throw new Error(
      "生产环境必须配置 SESSION_SECRET（≥32 字符）。请在环境变量或后台中设置。",
    );
  }

  return ensureDevSessionSecret();
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
  const current = getPasswordVersion();
  // 无 version 的旧 cookie 在改密后失效；未改密时 current 多为 "0"，兼容旧会话
  if ((session.passwordVersion || "0") !== current) {
    session.isLoggedIn = false;
    session.username = "";
    session.passwordVersion = undefined;
    await session.save();
    throw new AuthError("会话已失效，请重新登录");
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
