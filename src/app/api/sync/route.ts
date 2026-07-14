import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getSyncStatus, syncIndex } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json({ ok: true, ...getSyncStatus() });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const force = req.nextUrl.searchParams.get("force") !== "0";
    const result = await syncIndex(force);
    return NextResponse.json({ ok: true, ...result });
  });
}
