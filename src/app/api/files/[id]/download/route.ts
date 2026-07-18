import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getFile } from "@/lib/drive";
import { formatNetworkError } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 登录态下载 / 预览：
 * - 默认 302 → Notion 临时链（图片/视频/音频/PDF/下载，浏览器直连）
 * - ?proxy=1 服务端代拉（仅文本预览，绕过 Notion CDN CORS）
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { id } = await ctx.params;
    const useProxy = req.nextUrl.searchParams.get("proxy") === "1";

    let file;
    try {
      file = await getFile(id);
    } catch (err) {
      return NextResponse.json(
        { error: formatNetworkError(err, "读取文件信息") },
        { status: 500 },
      );
    }

    if (!file.downloadUrl) {
      return NextResponse.json(
        {
          error:
            "文件暂无下载链接。可能附件未写入 Notion「File」属性，或链接已失效，请重新上传。",
        },
        { status: 404 },
      );
    }

    if (!/^https?:\/\//i.test(file.downloadUrl)) {
      return NextResponse.json({ error: "非法下载地址" }, { status: 400 });
    }

    // 媒体/下载：302 到 Notion
    if (!useProxy) {
      return NextResponse.redirect(file.downloadUrl, 302);
    }

    // 文本预览：服务端拉取再返回（同源，无 CORS）
    try {
      const upstream = await fetch(file.downloadUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "NotionPan/1.0",
          Accept: "text/*,*/*",
        },
      });

      if (!upstream.ok) {
        // 链接过期再取一次
        try {
          file = await getFile(id);
          if (file.downloadUrl) {
            const retry = await fetch(file.downloadUrl, {
              redirect: "follow",
              headers: { "User-Agent": "NotionPan/1.0", Accept: "text/*,*/*" },
            });
            if (retry.ok) {
              const text = await retry.text();
              return new NextResponse(text.slice(0, 500_000), {
                status: 200,
                headers: {
                  "Content-Type": "text/plain; charset=utf-8",
                  "Cache-Control": "private, no-store",
                },
              });
            }
          }
        } catch {
          // fallthrough
        }
        return NextResponse.json(
          { error: `拉取文件失败（上游 HTTP ${upstream.status}）` },
          { status: 502 },
        );
      }

      const text = await upstream.text();
      return new NextResponse(text.slice(0, 500_000), {
        status: 200,
        headers: {
          "Content-Type":
            upstream.headers.get("content-type") ||
            file.mimeType ||
            "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    } catch (err) {
      return NextResponse.json(
        { error: formatNetworkError(err, "下载") },
        { status: 502 },
      );
    }
  });
}
