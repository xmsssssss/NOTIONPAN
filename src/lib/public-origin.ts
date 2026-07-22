import type { NextRequest } from "next/server";
import { getRuntimeEnv, ensureRuntimeEnvLoaded } from "./runtime-env";

/**
 * 生成对外可见的站点 origin（分享链接等）。
 * 优先 PUBLIC_URL / SITE_URL；否则用反向代理头；避免 Docker 下 nextUrl.origin 变成 http://0.0.0.0:3000。
 */
export function publicOrigin(req: NextRequest): string {
  ensureRuntimeEnvLoaded();
  const fromEnv = (
    getRuntimeEnv("PUBLIC_URL") ||
    getRuntimeEnv("SITE_URL") ||
    process.env.PUBLIC_URL ||
    process.env.SITE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
    }
  }

  const xfHost =
    (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
      .split(",")[0]
      ?.trim() || "";
  const xfProto = (
    req.headers.get("x-forwarded-proto") ||
    req.nextUrl.protocol.replace(":", "") ||
    "http"
  )
    .split(",")[0]
    ?.trim()
    .toLowerCase();

  if (xfHost && !isBindAllHost(xfHost)) {
    const proto = xfProto === "https" ? "https" : "http";
    return `${proto}://${xfHost}`;
  }

  const origin = req.nextUrl.origin;
  if (isBindAllHost(origin) || origin.includes("0.0.0.0")) {
    return origin
      .replace("://0.0.0.0", "://localhost")
      .replace("://[::]", "://localhost");
  }
  return origin;
}

function isBindAllHost(hostOrUrl: string): boolean {
  return /0\.0\.0\.0|\[::\]|^::$/i.test(hostOrUrl);
}
