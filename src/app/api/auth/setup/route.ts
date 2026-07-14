import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { readAppConfig, writeAppConfig, publicAppConfig } from "@/lib/app-config";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cfg = readAppConfig();
    if (cfg.setupCompleted) {
      return NextResponse.json({ error: "已完成初始化，请直接登录" }, { status: 400 });
    }

    const body = await req.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const siteTitle = String(body.siteTitle || "NotionPan").trim() || "NotionPan";

    if (username.length < 2) {
      return NextResponse.json({ error: "用户名至少 2 个字符" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const next = writeAppConfig({
      username,
      passwordHash,
      siteTitle,
      setupCompleted: true,
    });

    const session = await getSession();
    session.isLoggedIn = true;
    session.username = username;
    await session.save();

    return NextResponse.json({
      ok: true,
      ...publicAppConfig(next),
      isLoggedIn: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "初始化失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
