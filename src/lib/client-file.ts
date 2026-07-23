import type { DriveFile } from "./types";

/** 本站下载入口：服务端 302 到 Notion 临时链 */
export function fileDownloadHref(fileId: string): string {
  return `/api/files/${fileId}/download`;
}

/**
 * 复制到剪贴板。HTTP / 非安全上下文下 clipboard 可能为 undefined，回退 execCommand。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallthrough
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
