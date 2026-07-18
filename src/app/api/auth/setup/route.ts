import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  canRunSetup,
  getPasswordVersion,
  writeAppConfig,
  publicAppConfig,
} from "@/lib/app-config";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const gate = canRunSetup();
    if (!gate.ok) {
      const status = gate.code === "CONFIG_CORRUPT" ? 503 : 400;
      return NextResponse.json(
        { error: gate.reason || "无法初始化", code: gate.code },
        { status },
      );
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

    // 写入前再检查一次，缩小并发 setup 窗口
    const gate2 = canRunSetup();
    if (!gate2.ok) {
      return NextResponse.json(
        { error: gate2.reason || "无法初始化", code: gate2.code },
        { status: gate2.code === "CONFIG_CORRUPT" ? 503 : 400 },
      );
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
    session.passwordVersion = getPasswordVersion(next);
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
