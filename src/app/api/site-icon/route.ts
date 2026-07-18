import { NextResponse } from "next/server";
import { normalizeSiteIcon, readAppConfig } from "@/lib/app-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态 SVG 站点图标（与顶栏渐变风格一致） */
export async function GET() {
  const cfg = readAppConfig();
  const letter = normalizeSiteIcon(cfg.siteIcon);
  // 转义 XML
  const text = letter
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f7cff"/>
      <stop offset="45%" stop-color="#6d8fff"/>
      <stop offset="100%" stop-color="#22c3b5"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="18" fill="url(#g)"/>
  <text x="32" y="34" text-anchor="middle" dominant-baseline="middle"
    font-family="system-ui,Segoe UI,Microsoft YaHei,sans-serif"
    font-size="30" font-weight="700" fill="#ffffff">${text}</text>
</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
