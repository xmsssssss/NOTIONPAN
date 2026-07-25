import { unzipSync } from "fflate";

export type ArchiveEntry = {
  name: string;
  size: number;
  isDir: boolean;
};

const MAX_ARCHIVE_LIST_BYTES = 80 * 1024 * 1024; // 80MB

function lowerName(name: string) {
  return (name || "").toLowerCase();
}

export function isZipArchive(name: string, mimeType?: string): boolean {
  const n = lowerName(name);
  const m = (mimeType || "").toLowerCase();
  if (n.endsWith(".zip") || n.endsWith(".jar") || n.endsWith(".apk")) return true;
  if (m.includes("zip") || m === "application/java-archive") return true;
  return false;
}

/** 7z / rar / tar 等 */
export function isLibArchiveFormat(name: string, mimeType?: string): boolean {
  const n = lowerName(name);
  const m = (mimeType || "").toLowerCase();
  if (
    n.endsWith(".7z") ||
    n.endsWith(".rar") ||
    n.endsWith(".tar") ||
    n.endsWith(".tar.gz") ||
    n.endsWith(".tgz") ||
    n.endsWith(".tar.bz2") ||
    n.endsWith(".tbz2") ||
    n.endsWith(".tar.xz") ||
    n.endsWith(".txz")
  ) {
    return true;
  }
  if (
    m === "application/x-7z-compressed" ||
    m === "application/vnd.rar" ||
    m === "application/x-rar-compressed" ||
    m === "application/x-tar" ||
    m === "application/x-gtar"
  ) {
    return true;
  }
  return false;
}

/** 是否支持站内列目录预览（客户端可安全引用） */
export function isBrowsableArchive(name: string, mimeType?: string): boolean {
  return isZipArchive(name, mimeType) || isLibArchiveFormat(name, mimeType);
}

export function maxArchiveListBytes() {
  return MAX_ARCHIVE_LIST_BYTES;
}

function sortEntries(entries: ArchiveEntry[]): ArchiveEntry[] {
  const map = new Map<string, ArchiveEntry>();
  for (const e of entries) {
    if (!e.name) continue;
    const prev = map.get(e.name);
    if (!prev || e.isDir) map.set(e.name, e);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

/** ZIP 列目录（fflate，可在 Node 使用） */
export function listZipEntries(data: Uint8Array): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  unzipSync(data, {
    filter: (file) => {
      const name = file.name || "";
      if (!name) return false;
      entries.push({
        name: name.replace(/\/+$/, ""),
        size: file.originalSize || file.size || 0,
        isDir: name.endsWith("/"),
      });
      return false;
    },
  });
  return sortEntries(entries);
}
