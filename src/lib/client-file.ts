import type { DriveFile } from "./types";

/** 本站下载入口：服务端 302 到 Notion 临时链 */
export function fileDownloadHref(fileId: string): string {
  return `/api/files/${fileId}/download`;
}

/**
 * 打开/下载：不使用 location.href，避免整页跳走打断上传/音频。
 * 优先新标签；弹窗被拦时用隐藏 a[download] 点击。
 */
export function openFileDownload(file: DriveFile | string): void {
  const id = typeof file === "string" ? file : file.id;
  const href = fileDownloadHref(id);
  const name = typeof file === "string" ? undefined : file.name;

  const win = window.open(href, "_blank", "noopener,noreferrer");
  if (win) return;

  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener noreferrer";
  a.target = "_blank";
  if (name) a.setAttribute("download", name);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // 延迟移除，兼容部分浏览器
  setTimeout(() => {
    try {
      document.body.removeChild(a);
    } catch {
      // ignore
    }
  }, 0);
}
