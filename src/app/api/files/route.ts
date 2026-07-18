import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { listFiles, uploadFile } from "@/lib/drive";
import { assertWithinUploadLimit, getWorkspaceUploadLimit } from "@/lib/notion";
import { formatBytes, formatNetworkError } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 浏览器→服务器约占 0–40%；服务器→Notion 40–100% */
const CLIENT_SHARE = 40;

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
    try {
      const form = await req.formData();
      const file = form.get("file");
      const folder = String(form.get("folder") || "/");
      const streamProgress = String(form.get("stream") || "") === "1";

      if (!(file instanceof File)) {
        return NextResponse.json({ error: "缺少文件" }, { status: 400 });
      }

      // 尽早校验体积上限（避免大文件传完再报错）
      try {
        const limit = await getWorkspaceUploadLimit();
        assertWithinUploadLimit(file.size, limit, formatBytes);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "文件过大" },
          { status: 400 },
        );
      }

      // 兼容旧客户端：不带 stream=1 仍返回 JSON
      if (!streamProgress) {
        const result = await uploadFile({
          file,
          filename: file.name,
          folder,
        });
        return NextResponse.json({
          file: result.file,
          skipped: Boolean(result.skipped),
        });
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (obj: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          };
          try {
            send({
              type: "progress",
              pct: CLIENT_SHARE,
              phase: "received",
              message: "已到服务器，同步到 Notion…",
            });

            const result = await uploadFile({
              file,
              filename: file.name,
              folder,
              onProgress: (p) => {
                const pct = Math.min(
                  99,
                  CLIENT_SHARE + Math.round(p.ratio * (100 - CLIENT_SHARE)),
                );
                send({
                  type: "progress",
                  pct,
                  phase: p.phase,
                  message: p.message || "同步到 Notion…",
                  part: p.part,
                  parts: p.parts,
                });
              },
            });

            send({
              type: "done",
              pct: 100,
              file: result.file,
              skipped: Boolean(result.skipped),
            });
          } catch (err) {
            send({
              type: "error",
              error: formatNetworkError(err, "上传"),
            });
          } finally {
            controller.close();
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
    } catch (err) {
      return NextResponse.json(
        { error: formatNetworkError(err, "上传") },
        { status: 500 },
      );
    }
  });
}
