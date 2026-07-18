import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { publicAppConfig, readAppConfig, writeAppConfig } from "@/lib/app-config";
import { withAuth } from "@/lib/auth-guard";
import { getSession } from "@/lib/session";
import { readEnvConfig, writeEnvConfig, softReloadEnv, ENV_KEYS } from "@/lib/runtime-env";
import { getSyncStatus } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withAuth(async () => {
    const cfg = readAppConfig();
    const env = readEnvConfig();
    let index: ReturnType<typeof getSyncStatus> | null = null;
    try {
      index = getSyncStatus();
    } catch {
      index = null;
    }
    return NextResponse.json({
      ok: true,
      app: publicAppConfig(cfg),
      account: { username: cfg.username },
      env: env.masked,
      envKeys: ENV_KEYS,
      index,
    });
  });
}

export async function PUT(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const cfg = readAppConfig();
    const patch: Record<string, unknown> = {};

    if (typeof body.siteTitle === "string") {
      patch.siteTitle = body.siteTitle.trim() || "NotionPan";
    }
    if (typeof body.siteDescription === "string") {
      patch.siteDescription = body.siteDescription.trim();
    }
    if (typeof body.autoPlay === "boolean") {
      patch.autoPlay = body.autoPlay;
    }
    if (typeof body.siteIcon === "string") {
      patch.siteIcon = body.siteIcon;
    }

    // change username/password
    if (body.username || body.newPassword) {
      const currentPassword = String(body.currentPassword || "");
      if (!currentPassword) {
        return NextResponse.json({ error: "修改账号需提供当前密码" }, { status: 400 });
      }
      const ok = await bcrypt.compare(currentPassword, cfg.passwordHash);
      if (!ok) {
        return NextResponse.json({ error: "当前密码错误" }, { status: 401 });
      }
      if (typeof body.username === "string" && body.username.trim().length >= 2) {
        patch.username = body.username.trim();
      }
      if (typeof body.newPassword === "string" && body.newPassword) {
        if (body.newPassword.length < 6) {
          return NextResponse.json({ error: "新密码至少 6 位" }, { status: 400 });
        }
        patch.passwordHash = await bcrypt.hash(String(body.newPassword), 10);
      }
    }

    // env soft update
    let envSaved: string[] = [];
    if (body.env && typeof body.env === "object") {
      const result = writeEnvConfig(body.env as Record<string, string>);
      softReloadEnv();
      envSaved = result.saved;
    }

    const next = writeAppConfig(patch as Parameters<typeof writeAppConfig>[0]);

    // 改密后刷新当前会话 version，其它浏览器会话将在下次请求时失效
    if (typeof patch.passwordHash === "string" && patch.passwordHash) {
      const session = await getSession();
      if (session.isLoggedIn) {
        session.passwordVersion = next.passwordVersion || "0";
        session.username = next.username;
        await session.save();
      }
    }

    // 索引状态可选：保存 env 时不应因索引失败而整请求 500
    let index: ReturnType<typeof getSyncStatus> | null = null;
    try {
      index = getSyncStatus();
    } catch {
      index = null;
    }

    return NextResponse.json({
      ok: true,
      app: publicAppConfig(next),
      account: { username: next.username },
      env: readEnvConfig().masked,
      envSaved,
      index,
    });
  });
}
