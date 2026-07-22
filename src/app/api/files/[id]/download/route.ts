import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getFile } from "@/lib/drive";
import { formatNetworkError } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function isTextLike(mime: string, name: string): boolean {
  const m = (mime || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (m.startsWith("text/")) return true;
  if (m.includes("json") || m.includes("xml") || m.includes("javascript")) return true;
  return /\.(txt|md|markdown|json|xml|csv|log|srt|vtt|lrc|ass|ssa|yml|yaml|ini|conf|css|html?|js|ts|tsx|jsx)$/i.test(
    n,
  );
}

/**
 * 登录态下载 / 预览：
 * - 默认 302 → Notion 临时链（图片/视频/音频/下载）
 * - ?proxy=1 同源反代：文本预览、PDF（Edge 等无法 iframe 外链 PDF）
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

    // 媒体/下载：302 到 Notion（PDF 预览请走 proxy，避免跨域 iframe 被 Edge 拦截）
    if (!useProxy) {
      return NextResponse.redirect(file.downloadUrl, 302);
    }

    const fetchUpstream = async (url: string) =>
      fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "NotionPan/1.0",
          Accept: "*/*",
        },
      });

    try {
      let upstream = await fetchUpstream(file.downloadUrl);

      if (!upstream.ok) {
        try {
          file = await getFile(id);
          if (file.downloadUrl) {
            upstream = await fetchUpstream(file.downloadUrl);
          }
        } catch {
          // fallthrough
        }
      }

      if (!upstream.ok || !upstream.body) {
        return NextResponse.json(
          { error: `拉取文件失败（上游 HTTP ${upstream.status}）` },
          { status: 502 },
        );
      }

      const mime =
        upstream.headers.get("content-type") ||
        file.mimeType ||
        "application/octet-stream";
      const asText = isTextLike(mime, file.name);

      if (asText) {
        const text = await upstream.text();
        return new NextResponse(text.slice(0, 500_000), {
          status: 200,
          headers: {
            "Content-Type": mime.includes("charset")
              ? mime
              : `${mime.split(";")[0]}; charset=utf-8`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      // PDF / 二进制：流式反代，inline 便于 iframe/object 预览
      const headers = new Headers();
      headers.set("Content-Type", mime);
      headers.set(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      headers.set("Cache-Control", "private, max-age=120");
      headers.set("X-Content-Type-Options", "nosniff");
      const len = upstream.headers.get("content-length");
      if (len) headers.set("Content-Length", len);

      return new NextResponse(upstream.body, { status: 200, headers });
    } catch (err) {
      return NextResponse.json(
        { error: formatNetworkError(err, "下载") },
        { status: 502 },
      );
    }
  });
}
