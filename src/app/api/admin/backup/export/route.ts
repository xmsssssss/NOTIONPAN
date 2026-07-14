import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { exportBackup } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const includeIndex = req.nextUrl.searchParams.get("index") !== "0";
    const payload = exportBackup({ includeIndex });
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="notionpan-backup-${Date.now()}.json"`,
      },
    });
  });
}
