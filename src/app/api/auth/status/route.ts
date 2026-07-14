import { NextResponse } from "next/server";
import { publicAppConfig, readAppConfig } from "@/lib/app-config";
import { getSession } from "@/lib/session";
import { ensureRuntimeEnvLoaded, getRuntimeEnv } from "@/lib/runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureRuntimeEnvLoaded();
  const cfg = readAppConfig();
  const session = await getSession();
  const hasApiKey = Boolean(getRuntimeEnv("NOTION_API_KEY")?.trim());
  const hasDatabaseId = Boolean(getRuntimeEnv("NOTION_DATABASE_ID")?.trim());
  return NextResponse.json({
    ...publicAppConfig(cfg),
    isLoggedIn: Boolean(session.isLoggedIn),
    sessionUser: session.isLoggedIn ? session.username : null,
    hasApiKey,
    hasDatabaseId,
    hasNotionConfig: hasApiKey && hasDatabaseId,
  });
}
