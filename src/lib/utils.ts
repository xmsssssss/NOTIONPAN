import type { FileKind } from "./types";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
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
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    /\.(txt|md|markdown|json|csv|xml|yaml|yml|html|htm|css|js|ts|jsx|tsx|log|ini|conf|sh|py|java|c|cpp|h|hpp|go|rs|rb|php|sql)$/i.test(lower)
  ) {
    return "file";
  }
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
