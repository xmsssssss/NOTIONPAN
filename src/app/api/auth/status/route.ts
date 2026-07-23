import { NextResponse } from "next/server";
import {
  isConfigCorrupt,
  normalizeSiteIcon,
  publicAppConfig,
  readAppConfig,
} from "@/lib/app-config";
import { getSession } from "@/lib/session";
import { ensureRuntimeEnvLoaded, getRuntimeEnv } from "@/lib/runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 未登录：只返回建站/登录页需要的最少字段，不暴露账号与 Notion 配置探测信息。
 * 已登录：完整 publicAppConfig + Notion 配置状态。
 */
export async function GET() {
  ensureRuntimeEnvLoaded();
  const cfg = readAppConfig();
  const session = await getSession();
  const loggedIn = Boolean(session.isLoggedIn);

  if (!loggedIn) {
    const corrupt = isConfigCorrupt() || cfg.username === "__corrupt__";
    return NextResponse.json({
      setupCompleted: corrupt ? true : Boolean(cfg.setupCompleted),
      siteTitle: corrupt ? "NotionPan" : cfg.siteTitle || "NotionPan",
      siteDescription: corrupt ? "" : cfg.siteDescription || "",
      siteIcon: normalizeSiteIcon(cfg.siteIcon),
      autoPlay: true,
      isLoggedIn: false,
      sessionUser: null,
      // 未登录不返回 username / hasApiKey / hasDatabaseId / hasNotionConfig
    });
  }

  const hasApiKey = Boolean(getRuntimeEnv("NOTION_API_KEY")?.trim());
  const hasDatabaseId = Boolean(getRuntimeEnv("NOTION_DATABASE_ID")?.trim());
  return NextResponse.json({
    ...publicAppConfig(cfg),
    isLoggedIn: true,
    sessionUser: session.username || cfg.username || null,
    hasApiKey,
    hasDatabaseId,
    hasNotionConfig: hasApiKey && hasDatabaseId,
  });
}
