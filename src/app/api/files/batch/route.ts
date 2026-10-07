import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { deleteFile, moveFile } from "@/lib/drive";
import type { BatchEvent, BatchFailure } from "@/lib/batch";
import type { DriveFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单次批量上限，避免一个请求跑太久 */
const MAX_BATCH = 200;

/**
 * 批量操作文件（不含文件夹）。逐个串行执行，Notion 限流由 withNotionRetry 兜底。
 * 以 NDJSON 流逐项回报进度：start → item × N → done。部分失败不中断。
 * 参数错误仍返回普通 JSON + 4xx。
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
    const total = ids.length;

    const encoder = new TextEncoder();
    // 客户端断开后不再处理剩余项（已完成的保持完成）
    const signal = req.signal;

    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      // 客户端读取方取消（点了停止 / 关页面）：不再处理剩余项
      cancel() {
        closed = true;
      },
      async start(controller) {
        const send = (ev: BatchEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
          } catch {
            closed = true;
          }
        };

        const succeeded: string[] = [];
        const files: DriveFile[] = [];
        const failed: BatchFailure[] = [];

        try {
          send({ type: "start", total });
          let done = 0;
          for (const id of ids) {
            if (signal.aborted || closed) break;
            try {
              let file: DriveFile | undefined;
              if (action === "delete") {
                await deleteFile(id);
              } else {
                file = await moveFile(id, target);
                files.push(file);
              }
              succeeded.push(id);
              done += 1;
              send({ type: "item", done, total, id, ok: true, file });
            } catch (err) {
              const error = err instanceof Error ? err.message : "操作失败";
              failed.push({ id, error });
              done += 1;
              send({ type: "item", done, total, id, ok: false, error });
            }
          }
          send({ type: "done", succeeded, failed, files });
        } catch (err) {
          send({ type: "error", error: err instanceof Error ? err.message : "批量操作失败" });
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // ignore
            }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
