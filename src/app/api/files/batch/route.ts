import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { deleteFile, moveFile } from "@/lib/drive";
import type { DriveFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单次批量上限，避免一个请求跑太久 */
const MAX_BATCH = 200;

type Failure = { id: string; error: string };

/**
 * 批量操作文件（不含文件夹）。逐个串行执行，Notion 限流由 withNotionRetry 兜底。
 * 部分失败不中断：返回成功与失败列表，由前端汇总提示。
 */
export async function POST(req: NextRequest) {
  return withAuth(async () => {
    let body: { action?: unknown; ids?: unknown; folder?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }

    const action = body.action;
    if (action !== "delete" && action !== "move") {
      return NextResponse.json({ error: "action 需为 delete 或 move" }, { status: 400 });
    }

    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.filter((x): x is string => typeof x === "string" && x.trim() !== "")))
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "需要 ids" }, { status: 400 });
    }
    if (ids.length > MAX_BATCH) {
      return NextResponse.json({ error: `单次最多 ${MAX_BATCH} 个文件` }, { status: 400 });
    }

    if (action === "move" && typeof body.folder !== "string") {
      return NextResponse.json({ error: "move 需要 folder" }, { status: 400 });
    }
    const target = typeof body.folder === "string" ? body.folder : "/";

    const succeeded: string[] = [];
    const files: DriveFile[] = [];
    const failed: Failure[] = [];

    for (const id of ids) {
      try {
        if (action === "delete") {
          await deleteFile(id);
        } else {
          files.push(await moveFile(id, target));
        }
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : "操作失败" });
      }
    }

    return NextResponse.json({ succeeded, failed, files });
  });
}
