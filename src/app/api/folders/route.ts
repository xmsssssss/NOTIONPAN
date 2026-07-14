import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { createFolder, listAllFolders } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withAuth(async () => {
    const folders = await listAllFolders();
    return NextResponse.json({ folders });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const parent = String(body.parent || "/");
    if (!name) {
      return NextResponse.json({ error: "缺少文件夹名" }, { status: 400 });
    }
    const result = await createFolder(parent, name);
    return NextResponse.json(result);
  });
}
