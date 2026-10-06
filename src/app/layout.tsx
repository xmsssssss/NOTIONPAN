import type { Metadata, Viewport } from "next";
import "./globals.css";
import { readAppConfig } from "@/lib/app-config";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { Toaster } from "@/components/Toaster";

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
  icons: {
    icon: "/api/site-icon",
    apple: "/api/site-icon",
  },
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4f7cff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full overflow-hidden" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
