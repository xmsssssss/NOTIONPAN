import { NextRequest, NextResponse } from "next/server";
import {
  getShare,
  isShareActive,
  publicShareView,
  verifySharePassword,
  touchShare,
} from "@/lib/share";
import {
  sealShareUnlock,
  shareUnlockCookieName,
  shareUnlockCookieOptions,
  verifyShareUnlock,
} from "@/lib/share-unlock";
import {
  checkRateLimit,
  clearRateLimit,
  clientIpFromRequest,
  recordRateLimitFailure,
  shareRateKey,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const share = getShare(token);
  if (!share) {
    return NextResponse.json({ error: "分享不存在" }, { status: 404 });
  }
  const active = isShareActive(share);
  if (!active.ok) {
    return NextResponse.json({ error: active.reason, expired: true }, { status: 410 });
  }

  let unlocked = !share.passwordHash;
  if (share.passwordHash) {
    const cookie = req.cookies.get(shareUnlockCookieName(token))?.value;
    unlocked = verifyShareUnlock(token, cookie);
  }

  return NextResponse.json({
    ...publicShareView(share),
    unlocked,
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const share = getShare(token);
  if (!share) {
    return NextResponse.json({ error: "分享不存在" }, { status: 404 });
  }
  const active = isShareActive(share);
  if (!active.ok) {
    return NextResponse.json({ error: active.reason }, { status: 410 });
  }

  const ip = clientIpFromRequest(req);
  const rlKey = shareRateKey(ip, token);
  const gate = checkRateLimit(rlKey);
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.message, retryAfterSec: gate.retryAfterSec },
      {
        status: 429,
        headers: { "Retry-After": String(gate.retryAfterSec) },
      },
    );
  }

  const body = await req.json().catch(() => ({}));
  const password = String((body as { password?: string }).password || "");
  const ok = await verifySharePassword(share, password);
  if (!ok) {
    const after = recordRateLimitFailure(rlKey);
    if (!after.ok) {
      return NextResponse.json(
        { error: after.message, retryAfterSec: after.retryAfterSec },
        {
          status: 429,
          headers: { "Retry-After": String(after.retryAfterSec) },
        },
      );
    }
    return NextResponse.json(
      {
        error: "密码错误",
        remainingAttempts: after.remainingFree,
      },
      { status: 401 },
    );
  }

  clearRateLimit(rlKey);
  touchShare(token);
  const res = NextResponse.json({ ok: true, unlocked: true, ...publicShareView(share) });
  if (share.passwordHash) {
    const sealed = sealShareUnlock(token);
    res.cookies.set(
      shareUnlockCookieName(token),
      sealed.value,
      shareUnlockCookieOptions(sealed.maxAge),
    );
  }
  return res;
}
