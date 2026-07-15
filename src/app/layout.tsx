import type { Metadata, Viewport } from "next";
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
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: cfg.siteTitle || "NotionPan",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#4f7cff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full antialiased sm:min-h-screen sm:h-auto">
        {children}
      </body>
    </html>
  );
}
