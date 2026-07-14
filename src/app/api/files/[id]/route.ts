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
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return withAuth(async () => {
    const { id } = await ctx.params;
    await deleteFile(id);
    return NextResponse.json({ ok: true });
  });
}
