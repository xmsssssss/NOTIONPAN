import { iterateAllDataSourceRows, type Client } from "@notionhq/client";
import { getDataSourceId, withNotionRetry } from "./notion";
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

/** 兜底分页（无 data source 时）的页数上限；超出则报错而不是静默截断 */
const FALLBACK_MAX_PAGES = 100;

/**
 * 拉取数据库全部页面。
 * 官方限制：单次查询最多返回 10,000 条（超出时 request_status.type === "incomplete"）。
 * 有 data source 时使用 SDK 的 iterateAllDataSourceRows，按 created_time 分窗口突破上限。
 */
export async function queryAllNotionPages(
  notion: Client,
  queryPages: (
    notion: Client,
    filter: Record<string, unknown> | null,
    startCursor?: string | null,
    pageSize?: number,
  ) => Promise<{ results: PageLike[]; has_more: boolean; next_cursor: string | null }>,
): Promise<PageLike[]> {
  const dataSourceId = await getDataSourceId(notion);
  if (dataSourceId) {
    // helper 只调用 client.dataSources.query；包一层让每次请求仍享受网络层重试
    const retrying = {
      dataSources: {
        query: (args: Parameters<Client["dataSources"]["query"]>[0]) =>
          withNotionRetry(() => notion.dataSources.query(args), "查询数据库"),
      },
    } as unknown as Client;
    const all: PageLike[] = [];
    for await (const row of iterateAllDataSourceRows(retrying, {
      data_source_id: dataSourceId,
      page_size: 100,
    })) {
      all.push(row as unknown as PageLike);
    }
    return all;
  }

  const all: PageLike[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < FALLBACK_MAX_PAGES; i++) {
    const res = await queryPages(notion, null, cursor, 100);
    all.push(...(res.results as PageLike[]));
    if (!res.has_more || !res.next_cursor) return all;
    cursor = res.next_cursor;
  }
  // 宁可同步失败（保留旧索引），也不用被截断的结果覆盖索引
  throw new Error(
    `数据库超过 ${FALLBACK_MAX_PAGES * 100} 条，且无法使用 data source 分窗口查询，已中止同步。请设置 NOTION_DATA_SOURCE_ID。`,
  );
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
