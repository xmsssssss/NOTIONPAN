import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { softReloadEnv, readEnvConfig } from "@/lib/runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return withAuth(async () => {
    const result = softReloadEnv();
    return NextResponse.json({
      ok: true,
      reloaded: result.keys,
      env: readEnvConfig().masked,
    });
  });
}
