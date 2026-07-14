import type { Metadata } from "next";
import "./globals.css";
import { readAppConfig } from "@/lib/app-config";

const cfg = (() => {
  try {
    return readAppConfig();
  } catch {
    return { siteTitle: "NotionPan", siteDescription: "把 Notion 数据库当作网盘" };
  }
})();

export const metadata: Metadata = {
  title: cfg.siteTitle || "NotionPan",
  description: cfg.siteDescription || "把 Notion 数据库当作网盘：上传、下载、预览文件",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
