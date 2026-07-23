import crypto from "crypto";
import { getRuntimeEnv, ensureRuntimeEnvLoaded } from "./runtime-env";

const COOKIE_PREFIX = "share_ok_";
const DEFAULT_TTL_SEC = 60 * 60 * 12; // 12h

function unlockSecret(): string {
  ensureRuntimeEnvLoaded();
  const secret = getRuntimeEnv("SESSION_SECRET");
  if (secret && secret.length >= 32) return secret;
  // 与 session 开发兜底策略一致：无配置时用固定进程可读串（生产应配 SESSION_SECRET）
  return "notionpan-share-unlock-dev-secret-change-me-32b";
}

/** Cookie 名绑定完整 token 的摘要，避免前 12 位碰撞 */
export function shareUnlockCookieName(token: string): string {
  const dig = crypto
    .createHash("sha256")
    .update(`share-unlock-name:${token}`)
    .digest("base64url")
    .slice(0, 22);
  return `${COOKIE_PREFIX}${dig}`;
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", unlockSecret())
    .update(payload)
    .digest("base64url");
}

/**
 * 签发解锁 Cookie 值：`exp.sig`
 * exp = unix 秒；sig = HMAC(token|exp)
 */
export function sealShareUnlock(
  token: string,
  ttlSec = DEFAULT_TTL_SEC,
): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${token}|${exp}`;
  const value = `${exp}.${sign(payload)}`;
  return { value, maxAge: ttlSec };
}

/** 校验 Cookie 是否对应该 token 且未过期 */
export function verifyShareUnlock(
  token: string,
  cookieValue: string | undefined | null,
): boolean {
  if (!cookieValue || !token) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;
  const [expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;

  const payload = `${token}|${exp}`;
  const expected = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function shareUnlockCookieOptions(maxAge: number) {
  ensureRuntimeEnvLoaded();
  const secureEnv =
    getRuntimeEnv("COOKIE_SECURE") ??
    process.env.COOKIE_SECURE ??
    "0";
  const secure = secureEnv === "1" || secureEnv === "true";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure,
  };
}
