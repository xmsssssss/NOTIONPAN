import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getFile } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 登录态下载：
 * - 默认 302 到 Notion 签名 URL（自用，省带宽）
 * - ?proxy=1 时服务端反代（仅用于文本预览等需同源读 body 的场景）
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { id } = await ctx.params;
    const file = await getFile(id);

    if (!file.downloadUrl) {
      return NextResponse.json({ error: "文件暂无下载链接" }, { status: 404 });
    }

    const useProxy = req.nextUrl.searchParams.get("proxy") === "1";
    if (!useProxy) {
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
      `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);

    return new NextResponse(upstream.body, { status: 200, headers });
  });
}
