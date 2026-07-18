import { NextResponse } from "next/server";
import { ensureDatabaseSchema, getSyncStatus, getUploadLimitInfo } from "@/lib/drive";
import { getRuntimeEnv, ensureRuntimeEnvLoaded } from "@/lib/runtime-env";
import { requireSession, AuthError } from "@/lib/session";
import { readAppConfig } from "@/lib/app-config";
import { formatBytes } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureRuntimeEnvLoaded();
  try {
    const cfg = readAppConfig();
    if (!cfg.setupCompleted) {
      return NextResponse.json({
        ok: false,
        message: "尚未完成初始设置",
        hasApiKey: Boolean(getRuntimeEnv("NOTION_API_KEY")),
        hasDatabaseId: Boolean(getRuntimeEnv("NOTION_DATABASE_ID")),
      });
    }
    await requireSession();
    const schema = await ensureDatabaseSchema({ repair: false });
    const index = getSyncStatus();
    let uploadLimit: {
      maxFileUploadSizeInBytes: number;
      maxLabel: string;
      workspaceName: string | null;
    } | null = null;
    try {
      const lim = await getUploadLimitInfo();
      uploadLimit = {
        maxFileUploadSizeInBytes: lim.maxFileUploadSizeInBytes,
        maxLabel: formatBytes(lim.maxFileUploadSizeInBytes),
        workspaceName: lim.workspaceName,
      };
    } catch {
      uploadLimit = null;
    }
    return NextResponse.json({
      ok: schema.ok,
      message: schema.message,
      properties: schema.properties,
      missing: schema.missing,
      hasApiKey: Boolean(getRuntimeEnv("NOTION_API_KEY")),
      hasDatabaseId: Boolean(getRuntimeEnv("NOTION_DATABASE_ID")),
      index,
      uploadLimit,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ ok: false, message: "未登录", code: "UNAUTHORIZED" }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "健康检查失败";
    return NextResponse.json(
      {
        ok: false,
        message,
        hasApiKey: Boolean(getRuntimeEnv("NOTION_API_KEY")),
        hasDatabaseId: Boolean(getRuntimeEnv("NOTION_DATABASE_ID")),
      },
      { status: 500 },
    );
  }
}
