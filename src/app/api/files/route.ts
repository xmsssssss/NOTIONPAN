import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { listFiles, uploadFile } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const { searchParams } = new URL(req.url);
    const folder = searchParams.get("folder") || "/";
    const query = searchParams.get("q") || undefined;
    const cursor = searchParams.get("cursor") || undefined;
    const refresh = searchParams.get("refresh") === "1";
    const result = await listFiles({ folder, query, cursor, refresh });
    return NextResponse.json(result);
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const form = await req.formData();
    const file = form.get("file");
    const folder = String(form.get("folder") || "/");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少文件" }, { status: 400 });
    }

    const result = await uploadFile({
      file,
      filename: file.name,
      folder,
    });

    return NextResponse.json({ file: result });
  });
}
