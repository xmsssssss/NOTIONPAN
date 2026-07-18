import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@notionhq/client";
import {
  advanceImportJobByUploadId,
  removePageFromIndex,
  syncPageToIndex,
} from "@/lib/drive";
import { getRuntimeEnv, writeEnvConfig, softReloadEnv } from "@/lib/runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Notion Webhooks 回调（需公网 HTTPS）
 *
 * URL: https://你的域名/api/webhooks/notion
 *
 * 建议订阅：
 * - file_upload.completed / upload_failed / expired
 * - page.created / page.deleted / page.undeleted / page.properties_updated
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const verificationToken =
    typeof payload.verification_token === "string"
      ? payload.verification_token
      : "";
  if (verificationToken) {
    try {
      writeEnvConfig({ NOTION_WEBHOOK_TOKEN: verificationToken });
      softReloadEnv();
    } catch {
      // ignore
    }
    return NextResponse.json({ ok: true, verified: true });
  }

  const token = getRuntimeEnv("NOTION_WEBHOOK_TOKEN") || "";
  if (token) {
    const signature =
      req.headers.get("x-notion-signature") ||
      req.headers.get("X-Notion-Signature");
    const ok = await verifyWebhookSignature({
      body: rawBody,
      signature,
      verificationToken: token,
    });
    if (!ok) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  const type = String(payload.type || "");
  const entity = payload.entity as { id?: string; type?: string } | undefined;
  const entityId = entity?.id;
  const entityType = entity?.type;

  try {
    // —— File Upload 事件 ——
    if (entityType === "file_upload" && entityId) {
      if (type === "file_upload.completed") {
        await advanceImportJobByUploadId(entityId);
      } else if (
        type === "file_upload.upload_failed" ||
        type === "file_upload.expired"
      ) {
        const data = payload.data as
          | {
              file_import_result?: {
                error?: { message?: string };
              };
            }
          | undefined;
        const detail =
          data?.file_import_result?.error?.message ||
          (type === "file_upload.expired" ? "expired" : "upload_failed");
        await advanceImportJobByUploadId(entityId, {
          forceFail: `Notion 导入失败：${detail}`,
        });
      }
      return NextResponse.json({ ok: true, kind: "file_upload" });
    }

    // —— 页面增量同步 ——
    if (entityType === "page" && entityId) {
      if (
        type === "page.deleted" ||
        type === "page.locked" // 不处理 locked，仅删/改
      ) {
        if (type === "page.deleted") {
          await removePageFromIndex(entityId);
          return NextResponse.json({ ok: true, kind: "page", action: "deleted" });
        }
      }
      if (
        type === "page.created" ||
        type === "page.undeleted" ||
        type === "page.properties_updated" ||
        type === "page.content_updated" ||
        type === "page.moved"
      ) {
        const action = await syncPageToIndex(entityId);
        return NextResponse.json({ ok: true, kind: "page", action });
      }
    }
  } catch {
    // 仍 200，避免无限重试
  }

  return NextResponse.json({ ok: true, ignored: true, type });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/webhooks/notion",
    subscribe: [
      "file_upload.completed",
      "file_upload.upload_failed",
      "file_upload.expired",
      "page.created",
      "page.deleted",
      "page.undeleted",
      "page.properties_updated",
    ],
  });
}
