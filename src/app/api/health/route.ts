import { NextResponse } from "next/server";
import { ensureDatabaseSchema, getSyncStatus } from "@/lib/drive";
import { getRuntimeEnv, ensureRuntimeEnvLoaded } from "@/lib/runtime-env";
import { requireSession, AuthError } from "@/lib/session";
import { readAppConfig } from "@/lib/app-config";

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
    const schema = await ensureDatabaseSchema();
    const index = getSyncStatus();
    return NextResponse.json({
      ok: schema.ok,
      message: schema.message,
      properties: schema.properties,
      hasApiKey: Boolean(getRuntimeEnv("NOTION_API_KEY")),
      hasDatabaseId: Boolean(getRuntimeEnv("NOTION_DATABASE_ID")),
      index,
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
