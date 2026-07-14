import { NextResponse } from "next/server";
import { AuthError, requireSession } from "./session";
import { readAppConfig } from "./app-config";

export async function withAuth(
  handler: () => Promise<Response | NextResponse>,
): Promise<Response | NextResponse> {
  try {
    const cfg = readAppConfig();
    if (!cfg.setupCompleted) {
      return NextResponse.json(
        { error: "请先完成初始账号设置", code: "SETUP_REQUIRED" },
        { status: 403 },
      );
    }
    await requireSession();
    return await handler();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: "UNAUTHORIZED" }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "服务器错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
