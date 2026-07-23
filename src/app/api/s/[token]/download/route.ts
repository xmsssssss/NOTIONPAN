import { NextRequest, NextResponse } from "next/server";
import { getFile } from "@/lib/drive";
import { getShare, isShareActive, touchShare } from "@/lib/share";
import {
  shareUnlockCookieName,
  verifyShareUnlock,
} from "@/lib/share-unlock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** 分享下载/预览：始终服务端反代（不暴露 Notion 签名 URL） */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const share = getShare(token);
    if (!share) {
      return NextResponse.json({ error: "分享不存在" }, { status: 404 });
    }
    const active = isShareActive(share);
    if (!active.ok) {
      return NextResponse.json({ error: active.reason }, { status: 410 });
    }

    const isPreview = req.nextUrl.searchParams.get("preview") === "1";
    if (!isPreview && !share.allowDownload) {
      return NextResponse.json({ error: "该分享禁止下载" }, { status: 403 });
    }
    if (isPreview && !share.allowPreview) {
      return NextResponse.json({ error: "该分享禁止预览" }, { status: 403 });
    }
    if (share.passwordHash) {
      const cookie = req.cookies.get(shareUnlockCookieName(token))?.value;
      if (!verifyShareUnlock(token, cookie)) {
        return NextResponse.json(
          { error: "需要密码", needPassword: true },
          { status: 401 },
        );
      }
    }

    const file = await getFile(share.fileId);
    if (!file.downloadUrl) {
      return NextResponse.json({ error: "文件暂无下载链接" }, { status: 404 });
    }
    if (!/^https:\/\//i.test(file.downloadUrl)) {
      return NextResponse.json({ error: "非法下载地址" }, { status: 400 });
    }

    touchShare(token);

    const upstream = await fetch(file.downloadUrl, {
      redirect: "follow",
      headers: { "User-Agent": "NotionPan/1.0" },
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "拉取文件失败" }, { status: 502 });
    }

    const headers = new Headers();
    const mime =
      upstream.headers.get("content-type") ||
      file.mimeType ||
      "application/octet-stream";
    headers.set("Content-Type", mime);
    // 危险类型强制下载，降低同源 XSS
    const dangerous =
      /text\/html|application\/xhtml|image\/svg\+xml|text\/xml|application\/xml/i.test(
        mime,
      );
    headers.set(
      "Content-Disposition",
      `${isPreview && !dangerous ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    headers.set("X-Content-Type-Options", "nosniff");
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    headers.set("Cache-Control", "private, max-age=300");

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "下载失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
