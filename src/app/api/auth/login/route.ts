import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { publicAppConfig, readAppConfig } from "@/lib/app-config";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cfg = readAppConfig();
    if (!cfg.setupCompleted) {
      return NextResponse.json({ error: "请先完成初始设置", code: "SETUP_REQUIRED" }, { status: 403 });
    }

    const body = await req.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });
    }

    const userOk = username === cfg.username;
    const passOk = userOk ? await bcrypt.compare(password, cfg.passwordHash) : false;
    if (!userOk || !passOk) {
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    const session = await getSession();
    session.isLoggedIn = true;
    session.username = cfg.username;
    await session.save();

    return NextResponse.json({
      ok: true,
      ...publicAppConfig(cfg),
      isLoggedIn: true,
      sessionUser: cfg.username,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
