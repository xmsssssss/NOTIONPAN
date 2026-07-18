import type { DriveFile } from "./types";

/** 本站下载入口：服务端 302 到 Notion 临时链 */
export function fileDownloadHref(fileId: string): string {
  return `/api/files/${fileId}/download`;
}

/** 打开/下载：走 302，浏览器最终直连 Notion */
export function openFileDownload(file: DriveFile | string): void {
  const id = typeof file === "string" ? file : file.id;
  window.location.href = fileDownloadHref(id);
}
