import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getFile } from "@/lib/drive";
import { isBrowsableArchive, maxArchiveListBytes } from "@/lib/archive";
import { listArchiveEntries } from "@/lib/archive-server";
import { formatBytes, formatNetworkError } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 列出压缩包内文件（zip / 7z / rar / tar 等；仅列目录，不解压到磁盘）
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { id } = await ctx.params;
    try {
      const file = await getFile(id);
      if (!isBrowsableArchive(file.name, file.mimeType)) {
        return NextResponse.json(
          { error: "仅支持浏览 .zip / .jar / .apk / .7z / .rar / .tar(.gz/.bz2/.xz)" },
          { status: 400 },
        );
      }
      if (!file.downloadUrl || !/^https?:\/\//i.test(file.downloadUrl)) {
        return NextResponse.json({ error: "无可用下载链接" }, { status: 404 });
      }

      const max = maxArchiveListBytes();
      if (file.size > 0 && file.size > max) {
        return NextResponse.json(
          {
            error: `压缩包过大（${formatBytes(file.size)}），预览上限 ${formatBytes(max)}`,
          },
          { status: 413 },
        );
      }

      const upstream = await fetch(file.downloadUrl, {
        redirect: "follow",
        headers: { "User-Agent": "NotionPan/1.0" },
      });
      if (!upstream.ok) {
        return NextResponse.json(
          { error: `获取压缩包失败（HTTP ${upstream.status}）` },
          { status: 502 },
        );
      }

      const buf = new Uint8Array(await upstream.arrayBuffer());
      if (buf.byteLength > max) {
        return NextResponse.json(
          {
            error: `压缩包过大（${formatBytes(buf.byteLength)}），预览上限 ${formatBytes(max)}`,
          },
          { status: 413 },
        );
      }

      let entries;
      try {
        entries = await listArchiveEntries(buf, file.name, file.mimeType);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          {
            error:
              msg.includes("password") || msg.includes("encrypt")
                ? "无法预览：压缩包可能已加密"
                : `解析压缩包失败：${msg}`,
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        ok: true,
        file: {
          id: file.id,
          name: file.name,
          size: file.size || buf.byteLength,
        },
        entries,
        count: entries.length,
      });
    } catch (err) {
      return NextResponse.json(
        { error: formatNetworkError(err, "浏览压缩包") },
        { status: 500 },
      );
    }
  });
}
