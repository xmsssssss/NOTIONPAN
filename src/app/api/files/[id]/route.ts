import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { deleteFile, getFile, moveFile, renameFile } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { id } = await ctx.params;
    const file = await getFile(id);
    return NextResponse.json({ file });
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    try {
      const { id } = await ctx.params;
      const body = await req.json();
      let file;
      if (typeof body.name === "string" && body.name.trim()) {
        file = await renameFile(id, body.name.trim());
      } else if (typeof body.folder === "string") {
        file = await moveFile(id, body.folder);
      } else {
        return NextResponse.json({ error: "需要 name 或 folder" }, { status: 400 });
      }
      return NextResponse.json({ file });
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      // 重名等业务错误用 409，便于前端提示
      const conflict = /已存在/.test(message);
      return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
    }
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { id } = await ctx.params;
    await deleteFile(id);
    return NextResponse.json({ ok: true });
  });
}
