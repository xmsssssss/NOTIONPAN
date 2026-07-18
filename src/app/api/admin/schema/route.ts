import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { createDriveDatabase, ensureDatabaseSchema } from "@/lib/drive";
import { formatNetworkError } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 检查 / 修复网盘数据库 Schema */
export async function GET() {
  return withAuth(async () => {
    try {
      const schema = await ensureDatabaseSchema({ repair: false });
      return NextResponse.json(schema);
    } catch (err) {
      return NextResponse.json(
        { ok: false, message: formatNetworkError(err, "检查 Schema") },
        { status: 500 },
      );
    }
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    try {
      const body = await req.json().catch(() => ({}));
      const action = String(body.action || "repair");

      if (action === "create") {
        const result = await createDriveDatabase({
          parentPageId:
            typeof body.parentPageId === "string" ? body.parentPageId : undefined,
          title: typeof body.title === "string" ? body.title : undefined,
        });
        const schema = await ensureDatabaseSchema({ repair: true });
        return NextResponse.json({
          ok: true,
          created: result,
          schema,
        });
      }

      // 默认：修复缺失属性
      const schema = await ensureDatabaseSchema({ repair: true });
      return NextResponse.json(schema);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : formatNetworkError(err, "Schema");
      return NextResponse.json({ ok: false, message }, { status: 500 });
    }
  });
}
