import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { startImportFromUrl } from "@/lib/drive";
import { formatNetworkError } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 从公网 HTTPS 直链导入文件到当前目录（Notion external_url）
 * body: { url, filename?, folder? }
 *
 * 立即返回 jobId；前端轮询 GET /api/files/import?jobId=
 * 完成可由 Webhook 或服务端后台轮询推进。
 */
export async function POST(req: NextRequest) {
  return withAuth(async () => {
    try {
      const body = await req.json();
      const url = String(body.url || "").trim();
      const filename =
        typeof body.filename === "string" && body.filename.trim()
          ? body.filename.trim()
          : undefined;
      const folder = String(body.folder || "/");

      if (!url) {
        return NextResponse.json({ error: "请填写文件链接" }, { status: 400 });
      }

      const result = await startImportFromUrl({ url, filename, folder });

      if (result.mode === "skipped") {
        return NextResponse.json({
          skipped: true,
          file: result.file,
          status: "skipped",
        });
      }

      return NextResponse.json({
        jobId: result.jobId,
        status: result.status,
        async: true,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : formatNetworkError(err, "导入");
      const bad =
        /https:\/\/|公网|链接|超时|导入失败|已存在|拒绝|validation|无法访问|防盗链|签名/i.test(
          message,
        );
      return NextResponse.json(
        { error: message },
        { status: bad ? 400 : 500 },
      );
    }
  });
}

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId") || "";
    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }
    const { getImportJobStatus } = await import("@/lib/drive");
    const job = await getImportJobStatus(jobId);
    if (!job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    return NextResponse.json(job);
  });
}
