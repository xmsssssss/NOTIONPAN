import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getShare, publicShareView, revokeShare } from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { token } = await ctx.params;
    const share = getShare(token);
    if (!share) {
      return NextResponse.json({ error: "分享不存在" }, { status: 404 });
    }
    revokeShare(token);
    return NextResponse.json({ ok: true, share: publicShareView({ ...share, revoked: true }) });
  });
}
