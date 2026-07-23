import type { NextConfig } from "next";

// 局域网访问 dev 时允许的来源（HMR / 跨域），可用环境变量追加
// 例：ALLOWED_DEV_ORIGINS=192.168.66.134,10.0.0.5
const extraOrigins = (process.env.ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Docker / 精简部署
  output: "standalone",
  // node:sqlite 为 Node 内置，勿打包；sharp 为原生模块
  serverExternalPackages: ["sharp"],
  // 用局域网 IP 打开页面时，允许 dev 资源 / HMR
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "192.168.66.134",
    ...extraOrigins,
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  /**
   * WebDAV：对外 /webdav/* → Pages API /api/webdav/*
   * 用 rewrites 比 middleware 更稳，catch-all query.path 能正确带上
   */
  async rewrites() {
    return [
      {
        source: "/webdav",
        destination: "/api/webdav",
      },
      {
        source: "/webdav/",
        destination: "/api/webdav",
      },
      {
        source: "/webdav/:path*",
        destination: "/api/webdav/:path*",
      },
    ];
  },
};

export default nextConfig;
