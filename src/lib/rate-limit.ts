/**
 * 进程内密码尝试限流（重启清零）
 * - 前 FREE_ATTEMPTS 次失败：立即返回
 * - 之后：按失败次数递增等待（秒）
 */

const FREE_ATTEMPTS = 5;

type Bucket = {
  fails: number;
  lockedUntil: number; // ms epoch
};

const buckets = new Map<string, Bucket>();

function delaySecondsForFailCount(fails: number): number {
  // fails 从 FREE_ATTEMPTS+1 起算惩罚
  // 6→30s, 7→60s, 8→120s, 9→240s, 10+→480s（上限 15 分钟）
  const over = Math.max(0, fails - FREE_ATTEMPTS);
  if (over <= 0) return 0;
  const sec = Math.min(15 * 60, 30 * 2 ** (over - 1));
  return sec;
}

export type RateLimitResult =
  | { ok: true; remainingFree: number }
  | {
      ok: false;
      retryAfterSec: number;
      message: string;
    };

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b) {
    return { ok: true, remainingFree: FREE_ATTEMPTS };
  }
  if (b.lockedUntil > now) {
    const retryAfterSec = Math.ceil((b.lockedUntil - now) / 1000);
    return {
      ok: false,
      retryAfterSec,
      message: `尝试次数过多，请 ${retryAfterSec} 秒后再试`,
    };
  }
  const remainingFree = Math.max(0, FREE_ATTEMPTS - b.fails);
  return { ok: true, remainingFree };
}

/** 密码错误时调用 */
export function recordRateLimitFailure(key: string): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || (b.lockedUntil > 0 && b.lockedUntil <= now && b.fails >= FREE_ATTEMPTS)) {
    // 锁过期后：从 FREE_ATTEMPTS 起继续累计（更严），或重置为 1
    // 策略：锁过期后 fails 清零再记 1 次
    if (b && b.lockedUntil > 0 && b.lockedUntil <= now) {
      b = { fails: 0, lockedUntil: 0 };
    }
  }
  if (!b) b = { fails: 0, lockedUntil: 0 };

  b.fails += 1;
  const delaySec = delaySecondsForFailCount(b.fails);
  if (delaySec > 0) {
    b.lockedUntil = now + delaySec * 1000;
  } else {
    b.lockedUntil = 0;
  }
  buckets.set(key, b);

  if (delaySec > 0) {
    return {
      ok: false,
      retryAfterSec: delaySec,
      message: `密码错误次数过多，请 ${delaySec} 秒后再试`,
    };
  }
  return {
    ok: true,
    remainingFree: Math.max(0, FREE_ATTEMPTS - b.fails),
  };
}

/** 成功时清零 */
export function clearRateLimit(key: string) {
  buckets.delete(key);
}

export function clientIpFromRequest(req: {
  headers: Headers | { get(name: string): string | null };
}): string {
  const h = req.headers;
  const get = (name: string) =>
    typeof (h as Headers).get === "function"
      ? (h as Headers).get(name)
      : (h as { get(name: string): string | null }).get(name);

  const xf = get("x-forwarded-for") || get("X-Forwarded-For") || "";
  if (xf) {
    return xf.split(",")[0]?.trim() || "unknown";
  }
  const real = get("x-real-ip") || get("X-Real-IP");
  if (real) return real.trim();
  return "unknown";
}

export function loginRateKey(ip: string, username: string): string {
  return `login:${ip}:${username.toLowerCase()}`;
}

export function shareRateKey(ip: string, token: string): string {
  return `share:${ip}:${token}`;
}
