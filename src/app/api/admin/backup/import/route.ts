import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { importBackup, type BackupPayload } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = (await req.json()) as BackupPayload;
    const result = importBackup(body);
    return NextResponse.json(result);
  });
}
