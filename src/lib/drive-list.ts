/**
 * 网盘列表的纯逻辑：排序、面包屑。从 DriveApp 拆出，便于单测与复用。
 */
import type { DriveFile } from "./types";
import { sanitizeFolder } from "./utils";

export type SortKey = "name" | "size" | "kind" | "createdTime";
export type SortDir = "asc" | "desc";

export const SORT_KEYS: readonly SortKey[] = ["name", "size", "kind", "createdTime"];

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && (SORT_KEYS as readonly string[]).includes(v);
}

export function isSortDir(v: unknown): v is SortDir {
  return v === "asc" || v === "desc";
}

const KIND_SORT_ORDER: Record<string, number> = {
  image: 0,
  video: 1,
  audio: 2,
  pdf: 3,
  file: 4,
};

const byName = (a: string, b: string) =>
  a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });

/** 文件排序：同值时按名称兜底，保证顺序稳定 */
export function sortFiles<T extends Pick<DriveFile, "name" | "size" | "kind" | "createdTime">>(
  files: readonly T[],
  key: SortKey,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return files.slice().sort((a, b) => {
    let cmp = 0;
    if (key === "name") {
      cmp = byName(a.name, b.name);
    } else if (key === "size") {
      cmp = (a.size || 0) - (b.size || 0);
    } else if (key === "kind") {
      cmp = (KIND_SORT_ORDER[a.kind] ?? 9) - (KIND_SORT_ORDER[b.kind] ?? 9);
    } else {
      cmp = (a.createdTime || "").localeCompare(b.createdTime || "");
    }
    if (cmp === 0) cmp = byName(a.name, b.name);
    return cmp * sign;
  });
}

/** 文件夹只有名称：按名称排序时跟随方向，其它字段固定名称升序 */
export function sortFolders(folders: readonly string[], key: SortKey, dir: SortDir): string[] {
  const list = folders.slice().sort(byName);
  if (key === "name" && dir === "desc") list.reverse();
  return list;
}

/** 点击表头：同列切方向；换列时名称/类型默认升序，大小/时间默认降序 */
export function nextSort(cur: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" || key === "kind" ? "asc" : "desc" };
}

export type Crumb = { label: string; path: string };

export function buildCrumbs(folder: string, rootLabel = "根目录"): Crumb[] {
  const items: Crumb[] = [{ label: rootLabel, path: "/" }];
  let cur = "";
  for (const p of sanitizeFolder(folder).split("/").filter(Boolean)) {
    cur += `/${p}`;
    items.push({ label: p, path: cur });
  }
  return items;
}
