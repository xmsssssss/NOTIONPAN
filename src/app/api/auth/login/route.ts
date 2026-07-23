import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPasswordVersion, publicAppConfig, readAppConfig } from "@/lib/app-config";
import { getSession } from "@/lib/session";
import {
  checkRateLimit,
  clearRateLimit,
  clientIpFromRequest,
  loginRateKey,
  recordRateLimitFailure,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cfg = readAppConfig();
    if (cfg.username === "__corrupt__" || cfg.passwordHash === "__corrupt__") {
      return NextResponse.json(
        {
          error:
            "配置文件损坏，无法登录。请修复 data/app-config.json 或从备份恢复。",
          code: "CONFIG_CORRUPT",
        },
        { status: 503 },
      );
    }
    if (!cfg.setupCompleted) {
      return NextResponse.json({ error: "请先完成初始账号设置" }, { status: 400 });
    }

    const body = await req.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });
    }

    const ip = clientIpFromRequest(req);
    // 按 IP+用户名限流，避免拖垮同一 IP 多账号时误伤过大；也按 IP 单独限
    const keyUser = loginRateKey(ip, username);
    const keyIp = loginRateKey(ip, "*");
    for (const key of [keyUser, keyIp]) {
      const gate = checkRateLimit(key);
      if (!gate.ok) {
        return NextResponse.json(
          { error: gate.message, retryAfterSec: gate.retryAfterSec },
          {
            status: 429,
            headers: { "Retry-After": String(gate.retryAfterSec) },
          },
        );
      }
    }

    // 恒定耗时：即使用户名错误也做一次 compare，减轻用户名枚举
    const dummyHash =
      cfg.passwordHash || "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUV";
    const userOk = username === cfg.username;
    const passOk = await bcrypt.compare(
      password,
      userOk ? cfg.passwordHash : dummyHash,
    );

    if (!userOk || !passOk) {
      const afterUser = recordRateLimitFailure(keyUser);
      recordRateLimitFailure(keyIp);
      if (!afterUser.ok) {
        return NextResponse.json(
          {
            error: afterUser.message,
            retryAfterSec: afterUser.retryAfterSec,
          },
          {
            status: 429,
            headers: { "Retry-After": String(afterUser.retryAfterSec) },
          },
        );
      }
      return NextResponse.json(
        {
          error: "账号或密码错误",
          remainingAttempts: afterUser.remainingFree,
        },
        { status: 401 },
      );
    }

    clearRateLimit(keyUser);
    clearRateLimit(keyIp);

    const session = await getSession();
    session.isLoggedIn = true;
    session.username = cfg.username;
    session.passwordVersion = getPasswordVersion(cfg);
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
