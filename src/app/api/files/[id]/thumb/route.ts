import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getOrCreateThumb } from "@/lib/thumb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { id } = await ctx.params;
    const { buffer, contentType, cached } = await getOrCreateThumb(id);
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800");
    headers.set("X-Thumb-Cache", cached ? "HIT" : "MISS");
    headers.set("Content-Length", String(buffer.byteLength));
    void req;
    return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
  });
}
