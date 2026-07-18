import type { FileKind } from "./types";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 是否为可重试的网络抖动（ECONNRESET 等） */
export function isRetriableNetworkError(err: unknown): boolean {
  const e = err as Error & { cause?: { code?: string; message?: string; errno?: string } };
  const msg = e?.message || String(err);
  const cause = e?.cause;
  const detail = [msg, cause?.message, cause?.code, cause?.errno].filter(Boolean).join(" · ");
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EPIPE|EAI_AGAIN|UND_ERR|socket hang up|network|certificate|SSL|TLS|aborted|timeout/i.test(
    detail,
  );
}

/** 把 Node/undici 的「fetch failed」等网络错误转成可读中文 */
export function formatNetworkError(err: unknown, action = "请求"): string {
  const e = err as Error & { cause?: { code?: string; message?: string; errno?: string } };
  const msg = e?.message || String(err);
  const cause = e?.cause;
  const code = cause?.code || cause?.errno || "";
  const detail = [msg, cause?.message, code].filter(Boolean).join(" · ");

  if (isRetriableNetworkError(err)) {
    return `${action}失败：连接 Notion 不稳定（${code || "ECONNRESET/网络中断"}）。已自动重试仍失败，请稍后再试；若频繁出现，请检查代理或网络到 api.notion.com。`;
  }
  // Notion API 业务错误原文常含 validation_error 等
  if (msg && msg !== "fetch failed") return msg;
  return detail || `${action}失败`;
}

export function kindLabel(kind: FileKind): string {
  switch (kind) {
    case "image":
      return "图片";
    case "video":
      return "视频";
    case "audio":
      return "音频";
    case "pdf":
      return "PDF";
    default:
      return "文件";
  }
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function detectKind(mimeType: string, filename: string): FileKind {
  const lower = filename.toLowerCase();
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|tiff?)$/i.test(lower)) {
    return "image";
  }
  if (
    mimeType.startsWith("video/") ||
    /\.(mp4|webm|mov|mkv|avi|m4v|mpeg|mpg|ogv|3gp|3g2|flv|wmv|m2ts|mts|ts|rmvb|rm)$/i.test(lower)
  ) {
    return "video";
  }
  if (mimeType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac|wma|opus|alac|ape|aiff|mid|midi)$/i.test(lower)) {
    return "audio";
  }
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return "pdf";
  }
  // zip/rar/7z/exe/iso 等一律按通用文件，不做类型拦截
  return "file";
}

export function blockTypeForKind(kind: FileKind): "image" | "video" | "audio" | "pdf" | "file" {
  return kind;
}

export function getExt(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : "";
}

export function sanitizeFolder(folder?: string | null): string {
  if (!folder) return "/";
  let f = folder.replace(/\\/g, "/").trim();
  if (!f.startsWith("/")) f = `/${f}`;
  f = f.replace(/\/+/g, "/");
  if (f.length > 1 && f.endsWith("/")) f = f.slice(0, -1);
  return f || "/";
}

export function parentFolder(folder: string): string {
  const f = sanitizeFolder(folder);
  if (f === "/") return "/";
  const parts = f.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function joinFolder(base: string, name: string): string {
  const b = sanitizeFolder(base);
  const n = name.replace(/^\/+|\/+$/g, "");
  if (!n) return b;
  return b === "/" ? `/${n}` : `${b}/${n}`;
}
