import type { Client } from "@notionhq/client";
import {
  abortIndexFullSync,
  beginIndexFullSync,
  driveFileToRow,
  getIndexBackend,
  getMeta,
  indexCount,
  mergeConcurrentIndexWrites,
  replaceAllIndex,
  setMeta,
  type IndexRow,
} from "./db";
import type { DriveFile, FileKind } from "./types";
import { detectKind, normalizeNotionId, sanitizeFolder } from "./utils";

const FOLDER_MARKER = ".folder";
const FOLDER_MIME = "inode/directory";

type PageLike = {
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
  url?: string;
};

function propTitle(page: PageLike, name: string): string {
  const p = page.properties[name] as { title?: Array<{ plain_text?: string }> } | undefined;
  return p?.title?.map((t) => t.plain_text || "").join("") || "";
}

function propRichText(page: PageLike, name: string): string {
  const p = page.properties[name] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return p?.rich_text?.map((t) => t.plain_text || "").join("") || "";
}

function propNumber(page: PageLike, name: string): number {
  const p = page.properties[name] as { number?: number | null } | undefined;
  return typeof p?.number === "number" ? p.number : 0;
}

function propSelect(page: PageLike, name: string): string {
  const p = page.properties[name] as { select?: { name?: string } | null } | undefined;
  return p?.select?.name || "";
}

function pageToIndexFile(page: PageLike): DriveFile {
  const name = propTitle(page, "Name") || "未命名";
  const mimeType = propRichText(page, "MIME") || "application/octet-stream";
  const kind = (propSelect(page, "Type") as FileKind) || detectKind(mimeType, name);
  return {
    id: normalizeNotionId(page.id) || page.id,
    name,
    size: propNumber(page, "Size"),
    mimeType,
    kind,
    folder: sanitizeFolder(propRichText(page, "Folder") || "/"),
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    url: page.url,
  };
}

let syncPromise: Promise<{ count: number; syncedAt: string }> | null = null;
let bootstrapped = false;

export function isFolderMarkerFile(file: DriveFile): boolean {
  return file.name === FOLDER_MARKER || file.mimeType === FOLDER_MIME;
}

export async function queryAllNotionPages(
  notion: Client,
  queryPages: (
    notion: Client,
    filter: Record<string, unknown> | null,
    startCursor?: string | null,
    pageSize?: number,
  ) => Promise<{ results: PageLike[]; has_more: boolean; next_cursor: string | null }>,
): Promise<PageLike[]> {
  const all: PageLike[] = [];
  let cursor: string | null = null;
  // 上限约 2 万条（200 页 × 100）；再大需分页策略改造
  for (let i = 0; i < 200; i++) {
    const res = await queryPages(notion, null, cursor, 100);
    all.push(...(res.results as PageLike[]));
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return all;
}

export async function fullSyncFromNotion(
  notion: Client,
  queryPages: (
    notion: Client,
    filter: Record<string, unknown> | null,
    startCursor?: string | null,
    pageSize?: number,
  ) => Promise<{ results: PageLike[]; has_more: boolean; next_cursor: string | null }>,
): Promise<{ count: number; syncedAt: string }> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    beginIndexFullSync();
    let merged = false;
    try {
      const pages = await queryAllNotionPages(notion, queryPages);
      const snapshot: IndexRow[] = pages.map((page) => {
        const file = pageToIndexFile(page);
        return driveFileToRow(file, isFolderMarkerFile(file));
      });
      // 合并同步窗口内的上传/webhook 写入，避免 replace 冲掉
      // merge 与 replace 之间无 await，同进程内不会插入其它 upsert
      const rows = mergeConcurrentIndexWrites(snapshot);
      merged = true;
      replaceAllIndex(rows);
      const syncedAt = new Date().toISOString();
      setMeta("last_sync_at", syncedAt);
      setMeta("last_sync_count", String(rows.length));
      return { count: rows.length, syncedAt };
    } catch (e) {
      if (!merged) abortIndexFullSync();
      throw e;
    }
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

/** 有本地索引则优先读缓存；仅空库或 force 时全量同步 Notion */
export async function ensureIndexReady(
  notion: Client,
  queryPages: (
    notion: Client,
    filter: Record<string, unknown> | null,
    startCursor?: string | null,
    pageSize?: number,
  ) => Promise<{ results: PageLike[]; has_more: boolean; next_cursor: string | null }>,
  force = false,
): Promise<{ fromCache: boolean; syncedAt: string | null; count: number }> {
  const count = indexCount();
  const last = getMeta("last_sync_at");

  // 已有本地数据且非强制刷新 → 直接用缓存（进程重启也一样）
  if (!force && count > 0) {
    bootstrapped = true;
    return { fromCache: true, syncedAt: last, count };
  }

  // 空库或 force：全量同步；失败时若已有缓存则降级用缓存
  try {
    const res = await fullSyncFromNotion(notion, queryPages);
    bootstrapped = true;
    return { fromCache: false, syncedAt: res.syncedAt, count: res.count };
  } catch (e) {
    const fallbackCount = indexCount();
    if (fallbackCount > 0) {
      bootstrapped = true;
      return {
        fromCache: true,
        syncedAt: getMeta("last_sync_at"),
        count: fallbackCount,
      };
    }
    throw e;
  }
}

export function getIndexSyncMeta() {
  try {
    return {
      lastSyncAt: getMeta("last_sync_at"),
      lastSyncCount: Number(getMeta("last_sync_count") || "0"),
      count: indexCount(),
      bootstrapped,
      backend: getIndexBackend(),
      error: null as string | null,
    };
  } catch (e) {
    return {
      lastSyncAt: null,
      lastSyncCount: 0,
      count: 0,
      bootstrapped: false,
      backend: null as string | null,
      error: e instanceof Error ? e.message : "本地索引不可用",
    };
  }
}
