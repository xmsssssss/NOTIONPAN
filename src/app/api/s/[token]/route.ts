import { NextRequest, NextResponse } from "next/server";
import {
  getShare,
  isShareActive,
  publicShareView,
  verifySharePassword,
  touchShare,
} from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function unlockedCookieName(token: string) {
  return `share_ok_${token.slice(0, 12)}`;
}

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
    const cookie = req.cookies.get(unlockedCookieName(token))?.value;
    unlocked = cookie === "1";
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

  const body = await req.json().catch(() => ({}));
  const password = String((body as { password?: string }).password || "");
  const ok = await verifySharePassword(share, password);
  if (!ok) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  touchShare(token);
  const res = NextResponse.json({ ok: true, unlocked: true, ...publicShareView(share) });
  if (share.passwordHash) {
    res.cookies.set(unlockedCookieName(token), "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }
  return res;
}
