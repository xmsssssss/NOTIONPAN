import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getSyncStatus, syncIndex } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json({ ok: true, ...getSyncStatus() });
  });
}

export async function POST() {
  return withAuth(async () => {
    const result = await syncIndex();
    return NextResponse.json({ ok: true, ...result });
  });
}
