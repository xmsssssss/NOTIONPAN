import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { createFolder, deleteFolder, listAllFolders, renameFolder } from "@/lib/drive";
import { listIndexFilesUnder } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * - 无参数：列出全部目录（移动弹窗用）
 * - ?folder=/a：返回该目录下（含子目录）文件数量（删除文件夹确认用）
 */
export async function GET(req: NextRequest) {
  return withAuth(async () => {
    try {
      const { searchParams } = new URL(req.url);
      const folder = searchParams.get("folder");

      if (!folder || !folder.trim()) {
        const folders = await listAllFolders();
        return NextResponse.json({ folders });
      }

      const files = listIndexFilesUnder(folder);
      return NextResponse.json({ count: files.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest) {
  return withAuth(async () => {
    try {
      const body = await req.json();
      const { folder, name } = body;

      if (typeof folder !== "string" || !folder.trim()) {
        return NextResponse.json({ error: "需要 folder 参数" }, { status: 400 });
      }

      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "需要 name 参数" }, { status: 400 });
      }

      await renameFolder(folder, name);
      return NextResponse.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      const conflict = /已存在/.test(message);
      return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(async () => {
    try {
      const { searchParams } = new URL(req.url);
      const folder = searchParams.get("folder");

      if (!folder || !folder.trim()) {
        return NextResponse.json({ error: "需要 folder 参数" }, { status: 400 });
      }

      const deletedCount = await deleteFolder(folder);
      return NextResponse.json({ ok: true, deletedCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
