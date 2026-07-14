import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getFile } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { id } = await ctx.params;
    const file = await getFile(id);

    if (!file.downloadUrl) {
      return NextResponse.json({ error: "文件暂无下载链接" }, { status: 404 });
    }

    const redirect = req.nextUrl.searchParams.get("redirect") === "1";
    if (redirect) {
      return NextResponse.redirect(file.downloadUrl);
    }

    const upstream = await fetch(file.downloadUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "拉取文件失败" }, { status: 502 });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("content-type") || file.mimeType || "application/octet-stream",
    );
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);

    return new NextResponse(upstream.body, { status: 200, headers });
  });
}
