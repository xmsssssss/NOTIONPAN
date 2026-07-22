import type { DriveFile } from "./types";

/** 本站下载入口：服务端 302 到 Notion 临时链 */
export function fileDownloadHref(fileId: string): string {
  return `/api/files/${fileId}/download`;
}

/**
 * 打开/下载：只用一次隐藏 a 点击，避免 window.open(noopener) 在部分浏览器
 * 返回 null 后又走 fallback 导致双请求。
 */
export function openFileDownload(file: DriveFile | string): void {
  const id = typeof file === "string" ? file : file.id;
  const href = fileDownloadHref(id);

  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener noreferrer";
  // 不设 download：走 302 Notion 时由浏览器按响应处理；设 download 也拦不住跨域
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
    } catch {
      // ignore
    }
  }, 0);
}
