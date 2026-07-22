import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getFile } from "@/lib/drive";
import { publicOrigin } from "@/lib/public-origin";
import { createShare, listShares, publicShareView } from "@/lib/share";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const fileId = req.nextUrl.searchParams.get("fileId") || undefined;
    const shares = listShares(fileId).map(publicShareView);
    return NextResponse.json({ shares });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const fileId = String(body.fileId || "").trim();
    if (!fileId) {
      return NextResponse.json({ error: "缺少 fileId" }, { status: 400 });
    }

    const file = await getFile(fileId);
    const session = await getSession();

    const expiresInHours =
      body.expiresInHours == null || body.expiresInHours === ""
        ? null
        : Number(body.expiresInHours);

    const share = await createShare({
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      kind: file.kind,
      size: file.size,
      password: typeof body.password === "string" ? body.password : undefined,
      expiresInHours:
        expiresInHours != null && Number.isFinite(expiresInHours) && expiresInHours > 0
          ? expiresInHours
          : null,
      allowDownload: body.allowDownload !== false,
      allowPreview: body.allowPreview !== false,
      createdBy: session.username || "admin",
    });

    const origin = publicOrigin(req);
    return NextResponse.json({
      ok: true,
      share: publicShareView(share),
      url: `${origin}/s/${share.token}`,
    });
  });
}
