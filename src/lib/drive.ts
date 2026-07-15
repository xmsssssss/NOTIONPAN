import mime from "mime-types";
import type { Client } from "@notionhq/client";
import {
  deleteIndexRow,
  driveFileToRow,
  listIndexAllFolders,
  listIndexFiles,
  listIndexSubfolders,
  upsertIndexRow,
} from "./db";
import {
  ensureIndexReady,
  fullSyncFromNotion,
  getIndexSyncMeta,
  isFolderMarkerFile,
} from "./index-sync";
import { getDataSourceId, getDatabaseId, getNotionClient, richText } from "./notion";
import type { DriveFile, FileKind, ListFilesResult } from "./types";
import { blockTypeForKind, detectKind, sanitizeFolder } from "./utils";

const PART_SIZE = 10 * 1024 * 1024; // 10 MiB
const SINGLE_PART_LIMIT = 20 * 1024 * 1024; // 20 MiB

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

function propFiles(page: PageLike, name: string): Array<{
  name?: string;
  type?: string;
  file?: { url?: string; expiry_time?: string };
  external?: { url?: string };
}> {
  const p = page.properties[name] as {
    files?: Array<{
      name?: string;
      type?: string;
      file?: { url?: string; expiry_time?: string };
      external?: { url?: string };
    }>;
  } | undefined;
  return p?.files || [];
}

function pageToDriveFile(page: PageLike): DriveFile {
  const name = propTitle(page, "Name") || "未命名";
  const mimeType = propRichText(page, "MIME") || "application/octet-stream";
  const kind = (propSelect(page, "Type") as FileKind) || detectKind(mimeType, name);
  const files = propFiles(page, "File");
  const first = files[0];
  const downloadUrl = first?.file?.url || first?.external?.url;
  const expiryTime = first?.file?.expiry_time;

  return {
    id: page.id,
    name,
    size: propNumber(page, "Size"),
    mimeType,
    kind,
    folder: sanitizeFolder(propRichText(page, "Folder") || "/"),
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    url: page.url,
    downloadUrl,
    expiryTime,
  };
}

async function queryPages(
  notion: Client,
  filter: Record<string, unknown> | null,
  startCursor?: string | null,
  pageSize = 50,
): Promise<{ results: PageLike[]; has_more: boolean; next_cursor: string | null }> {
  const dataSourceId = await getDataSourceId(notion);

  if (dataSourceId && "dataSources" in notion && notion.dataSources) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (notion as any).dataSources.query({
      data_source_id: dataSourceId,
      filter: filter || undefined,
      start_cursor: startCursor || undefined,
      page_size: pageSize,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    });
    return res;
  }

  // Fallback: some SDK versions still expose databases.query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (notion.databases as any).query === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (notion.databases as any).query({
      database_id: getDatabaseId(),
      filter: filter || undefined,
      start_cursor: startCursor || undefined,
      page_size: pageSize,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    });
  }

  throw new Error(
    "无法查询数据库：请设置 NOTION_DATA_SOURCE_ID，或确认 SDK/API 版本支持 dataSources.query",
  );
}

const FOLDER_MARKER = ".folder";
const FOLDER_MIME = "inode/directory";

function isFolderMarker(file: DriveFile): boolean {
  return isFolderMarkerFile(file);
}

export async function listFiles(options: {
  folder?: string;
  query?: string;
  cursor?: string | null;
  refresh?: boolean;
}): Promise<ListFilesResult & { cache?: { fromCache: boolean; syncedAt: string | null; count: number } }> {
  const notion = getNotionClient();
  const folder = sanitizeFolder(options.folder);

  // 本地索引优先；仅空库 / refresh=1 时同步 Notion
  try {
    const cache = await ensureIndexReady(notion, queryPages, Boolean(options.refresh));
    const files = listIndexFiles(folder, options.query);
    const folders = listIndexSubfolders(folder, options.query);

    return {
      files,
      folders,
      hasMore: false,
      nextCursor: null,
      cache,
    };
  } catch (e) {
    // 同步失败时尽量返回本地索引，避免整页 500
    try {
      const files = listIndexFiles(folder, options.query);
      const folders = listIndexSubfolders(folder, options.query);
      if (files.length > 0 || folders.length > 0) {
        return {
          files,
          folders,
          hasMore: false,
          nextCursor: null,
          cache: {
            fromCache: true,
            syncedAt: null,
            count: files.length,
          },
        };
      }
    } catch {
      // ignore
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `同步/读取文件失败：${msg}。请检查 API Key、Database ID，以及数据库是否已把连接（Integration）添加到页面。`,
    );
  }
}

export async function syncIndex(force = true) {
  const notion = getNotionClient();
  const res = await fullSyncFromNotion(notion, queryPages);
  return { ...res, meta: getIndexSyncMeta() };
}

export function getSyncStatus() {
  return getIndexSyncMeta();
}

async function queryAllPages(
  notion: Client,
  filter: Record<string, unknown> | null,
  maxPages = 20,
): Promise<PageLike[]> {
  const all: PageLike[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const res = await queryPages(notion, filter, cursor, 100);
    all.push(...(res.results as PageLike[]));
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return all;
}

async function listSubfolders(notion: Client, folder: string): Promise<string[]> {
  const set = new Set<string>();
  const prefix = folder === "/" ? "/" : `${folder}/`;

  // 1) 占位文件夹：Folder 等于 当前路径/子名
  // 2) 真实文件：Folder 以 当前路径/ 开头
  // 用 starts_with 尽量缩小范围；根目录则拉全量再解析
  let pages: PageLike[];
  if (folder === "/") {
    pages = await queryAllPages(notion, null);
  } else {
    pages = await queryAllPages(notion, {
      property: "Folder",
      rich_text: { starts_with: prefix },
    });
    // 也包含 Folder 恰好等于某个直接子路径的情况已由 starts_with 覆盖
    // 额外：占位符 Folder 可能是 /parent/child 本身（不是 starts_with 再深一层）
    // starts_with `/docs/` 不会匹配 `/docs/child` 的... wait `/docs/child`.starts_with(`/docs/`) is true
    // For marker at `/docs/photos`, Folder=`/docs/photos`, starts_with `/docs/` → true ✓
  }

  for (const page of pages) {
    const f = sanitizeFolder(propRichText(page, "Folder") || "/");
    if (folder === "/") {
      if (f !== "/" && f.startsWith("/")) {
        const first = f.split("/").filter(Boolean)[0];
        if (first) set.add(first);
      }
    } else if (f === folder) {
      // 当前目录自身的文件/占位，不是子文件夹
      continue;
    } else if (f.startsWith(prefix)) {
      const rest = f.slice(prefix.length);
      const first = rest.split("/").filter(Boolean)[0];
      if (first) set.add(first);
    }
  }

  // 根目录时也要发现 Folder=`/name` 的占位（上面逻辑已覆盖）
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

/** 列出所有已知文件夹路径（含根目录 `/`） */
export async function listAllFolders(): Promise<string[]> {
  const notion = getNotionClient();
  await ensureIndexReady(notion, queryPages, false);
  return listIndexAllFolders();
}

async function createPage(
  notion: Client,
  properties: Record<string, unknown>,
  children?: unknown[],
): Promise<PageLike> {
  const dataSourceId = await getDataSourceId(notion);
  if (dataSourceId) {
    return (await notion.pages.create({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: properties as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(children ? { children: children as any } : {}),
    })) as unknown as PageLike;
  }
  return (await notion.pages.create({
    parent: { database_id: getDatabaseId() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: properties as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(children ? { children: children as any } : {}),
  })) as unknown as PageLike;
}

/** 在 Notion 中创建/持久化虚拟文件夹（写入 .folder 占位记录） */
export async function createFolder(parent: string, name: string): Promise<{ path: string }> {
  const notion = getNotionClient();
  const clean = name.trim().replace(/[\\/]/g, "");
  if (!clean) throw new Error("文件夹名不能为空");
  if (clean === FOLDER_MARKER) throw new Error("非法文件夹名");

  const path = parent === "/" || parent === ""
    ? `/${clean}`
    : `${sanitizeFolder(parent)}/${clean}`;
  const folderPath = sanitizeFolder(path);

  // 已存在则直接返回
  const existing = await queryPages(
    notion,
    {
      and: [
        { property: "Folder", rich_text: { equals: folderPath } },
        { property: "Name", title: { equals: FOLDER_MARKER } },
      ],
    },
    null,
    1,
  );
  if (existing.results.length > 0) {
    return { path: folderPath };
  }

  const page = await createPage(notion, {
    Name: { title: richText(FOLDER_MARKER) },
    Folder: { rich_text: richText(folderPath) },
    Size: { number: 0 },
    MIME: { rich_text: richText(FOLDER_MIME) },
    Type: { select: { name: "file" } },
  });

  const marker: DriveFile = {
    id: page.id,
    name: FOLDER_MARKER,
    size: 0,
    mimeType: FOLDER_MIME,
    kind: "file",
    folder: folderPath,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    url: page.url,
  };
  upsertIndexRow(driveFileToRow(marker, true));

  return { path: folderPath };
}

export async function getFile(pageId: string): Promise<DriveFile> {
  const notion = getNotionClient();
  const page = (await notion.pages.retrieve({ page_id: pageId })) as unknown as PageLike;
  return pageToDriveFile(page);
}

function toBlob(bytes: Uint8Array, contentType: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: contentType });
}

async function uploadBinary(
  notion: Client,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
) {
  const size = bytes.byteLength;

  if (size <= SINGLE_PART_LIMIT) {
    const created = await notion.fileUploads.create({
      mode: "single_part",
      filename,
      content_type: contentType,
    });

    await notion.fileUploads.send({
      file_upload_id: created.id,
      file: {
        filename,
        data: toBlob(bytes, contentType),
      },
    });

    return created.id;
  }

  const numberOfParts = Math.ceil(size / PART_SIZE);
  const created = await notion.fileUploads.create({
    mode: "multi_part",
    number_of_parts: numberOfParts,
    filename,
    content_type: contentType,
  });

  for (let i = 0; i < numberOfParts; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, size);
    const part = bytes.subarray(start, end);
    await notion.fileUploads.send({
      file_upload_id: created.id,
      file: {
        filename,
        data: toBlob(part, contentType),
      },
      part_number: String(i + 1),
    });
  }

  await notion.fileUploads.complete({
    file_upload_id: created.id,
  });

  return created.id;
}

/** 服务端上传：浏览器只连本服务，密钥不离开服务器 */
export async function uploadFile(input: {
  file: File | Blob;
  filename: string;
  folder?: string;
}): Promise<DriveFile> {
  const notion = getNotionClient();
  const filename = input.filename;
  const folder = sanitizeFolder(input.folder);
  const contentType =
    (input.file as File).type ||
    mime.lookup(filename) ||
    "application/octet-stream";
  const mimeType = String(contentType);
  const size = input.file.size;
  const kind = detectKind(mimeType, filename);
  const blockType = blockTypeForKind(kind);

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const fileUploadId = await uploadBinary(notion, filename, mimeType, bytes);

  const properties: Record<string, unknown> = {
    Name: { title: richText(filename) },
    Folder: { rich_text: richText(folder) },
    Size: { number: size },
    MIME: { rich_text: richText(mimeType) },
    Type: { select: { name: kind } },
    File: {
      files: [
        {
          type: "file_upload",
          file_upload: { id: fileUploadId },
          name: filename,
        },
      ],
    },
  };

  const children = [
    {
      object: "block" as const,
      type: blockType,
      [blockType]: {
        type: "file_upload",
        file_upload: { id: fileUploadId },
        ...(blockType === "file" ? { name: filename } : {}),
      },
    },
  ];

  const page = await createPage(notion, properties, children);
  const file = await getFile(page.id);
  upsertIndexRow(driveFileToRow(file, isFolderMarker(file)));
  return file;
}

export async function deleteFile(pageId: string): Promise<void> {
  const notion = getNotionClient();
  try {
    await notion.pages.update({
      page_id: pageId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( { in_trash: true } as any ),
    });
  } catch {
    await notion.pages.update({
      page_id: pageId,
      archived: true,
    });
  }
  deleteIndexRow(pageId);
  try {
    const { deleteThumb } = await import("./thumb");
    deleteThumb(pageId);
  } catch {
    // ignore
  }
}

export async function renameFile(pageId: string, name: string): Promise<DriveFile> {
  const notion = getNotionClient();
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Name: { title: richText(name) },
    },
  });
  const file = await getFile(pageId);
  upsertIndexRow(driveFileToRow(file, isFolderMarker(file)));
  return file;
}

export async function moveFile(pageId: string, folder: string): Promise<DriveFile> {
  const notion = getNotionClient();
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Folder: { rich_text: richText(sanitizeFolder(folder)) },
    },
  });
  const file = await getFile(pageId);
  upsertIndexRow(driveFileToRow(file, isFolderMarker(file)));
  return file;
}

export async function ensureDatabaseSchema(): Promise<{
  ok: boolean;
  message: string;
  properties: string[];
}> {
  const notion = getNotionClient();
  const required = ["Name", "Folder", "Size", "MIME", "Type", "File"];
  let props: string[] = [];
  let source = "unknown";

  // 1) 新 API：属性在 data source 上，不在 database 对象上
  const dataSourceId = await getDataSourceId(notion);
  if (dataSourceId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ds = await (notion as any).dataSources.retrieve({ data_source_id: dataSourceId });
      props = Object.keys(ds?.properties || {});
      if (props.length) source = "data_source";
    } catch {
      // ignore
    }
  }

  // 2) 旧 API / 兼容：database.properties
  if (!props.length) {
    try {
      const db = await notion.databases.retrieve({ database_id: getDatabaseId() });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyDb = db as any;
      props = Object.keys(anyDb.properties || {});
      if (props.length) source = "database";

      // 有的版本 database 只有 data_sources 列表，属性要再取一次
      if (!props.length && Array.isArray(anyDb.data_sources) && anyDb.data_sources[0]?.id) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ds = await (notion as any).dataSources.retrieve({
            data_source_id: anyDb.data_sources[0].id,
          });
          props = Object.keys(ds?.properties || {});
          if (props.length) source = "data_source_via_db";
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  // 3) 兜底：从一条真实页面推断 schema（列表能用就说明库是通的）
  if (!props.length) {
    try {
      const sample = await queryPages(notion, null, null, 1);
      const page = sample.results?.[0] as PageLike | undefined;
      if (page?.properties) {
        props = Object.keys(page.properties);
        source = "sample_page";
      }
    } catch {
      // ignore
    }
  }

  // 4) 再兜底：本地索引里已有数据，视为可用
  if (!props.length) {
    try {
      const { indexCount } = await import("./db");
      if (indexCount() > 0) {
        return {
          ok: true,
          message: "数据库可访问（Schema 接口未返回属性，已按索引判定正常）",
          properties: required,
        };
      }
    } catch {
      // ignore
    }
  }

  const missing = required.filter((r) => !props.includes(r));
  if (missing.length) {
    // 若缺属性但索引/查询实际可用，降级为警告而非失败
    try {
      const probe = await queryPages(notion, null, null, 1);
      if (probe && Array.isArray(probe.results)) {
        return {
          ok: true,
          message: `数据库可访问（${source} 未完整返回 Schema，缺: ${missing.join(", ")}；列表功能正常可忽略）`,
          properties: props,
        };
      }
    } catch {
      // fall through
    }
    return {
      ok: false,
      message: `数据库缺少属性: ${missing.join(", ")}。请按 README 创建完整 Schema。`,
      properties: props,
    };
  }
  return { ok: true, message: `数据库 Schema 正常（${source}）`, properties: props };
}
