import mime from "mime-types";
import type { Client } from "@notionhq/client";
import {
  deleteIndexRow,
  driveFileToRow,
  findIndexFileByName,
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
import {
  assertWithinUploadLimit,
  getDataSourceId,
  getDatabaseId,
  getNotionClient,
  getWorkspaceUploadLimit,
  richText,
  withNotionRetry,
} from "./notion";
import {
  createImportJob,
  getImportJob,
  getImportJobByUploadId,
  publicImportJob,
  updateImportJob,
  type ImportJob,
} from "./import-jobs";
import type { DriveFile, FileKind, ListFilesResult } from "./types";
import {
  blockTypeForKind,
  detectKind,
  formatBytes,
  normalizeNotionId,
  sanitizeFolder,
  sameNotionId,
} from "./utils";

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
    id: normalizeNotionId(page.id) || page.id,
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
    return withNotionRetry(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () =>
        (notion as any).dataSources.query({
          data_source_id: dataSourceId,
          filter: filter || undefined,
          start_cursor: startCursor || undefined,
          page_size: pageSize,
          sorts: [{ timestamp: "created_time", direction: "descending" }],
        }),
      "查询数据库",
    );
  }

  // Fallback: some SDK versions still expose databases.query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (notion.databases as any).query === "function") {
    return withNotionRetry(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () =>
        (notion.databases as any).query({
          database_id: getDatabaseId(),
          filter: filter || undefined,
          start_cursor: startCursor || undefined,
          page_size: pageSize,
          sorts: [{ timestamp: "created_time", direction: "descending" }],
        }),
      "查询数据库",
    );
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

export async function getUploadLimitInfo() {
  return getWorkspaceUploadLimit();
}

/** Webhook 增量：按页面 id 刷新本地索引 */
export async function syncPageToIndex(pageId: string): Promise<"upserted" | "deleted" | "skipped"> {
  const notion = getNotionClient();
  const pageIdNorm = normalizeNotionId(pageId);
  try {
    const page = (await withNotionRetry(
      () => notion.pages.retrieve({ page_id: pageIdNorm || pageId }),
      "读取页面",
      2,
    )) as unknown as PageLike & { archived?: boolean; in_trash?: boolean; parent?: { type?: string; database_id?: string; data_source_id?: string } };

    if (page.in_trash || page.archived) {
      deleteIndexRow(page.id || pageIdNorm);
      return "deleted";
    }

    // 仅处理属于本网盘数据库的页面（必须比对 ID，不能只看 parent.type）
    const dbId = getDatabaseId().replace(/-/g, "").toLowerCase();
    const parent = page.parent;
    const parentDb = String(parent?.database_id || "").replace(/-/g, "").toLowerCase();
    const dsId = (await getDataSourceId(notion))?.replace(/-/g, "").toLowerCase() || "";
    const parentDs = String(parent?.data_source_id || "").replace(/-/g, "").toLowerCase();
    const inDb =
      (Boolean(parentDb) && parentDb === dbId) ||
      (Boolean(parentDs) && Boolean(dsId) && parentDs === dsId);

    // 有明确 parent 且不在本库 → 跳过，避免 Webhook 把其它库页面写进索引
    if (parent && (parentDb || parentDs) && !inDb) {
      return "skipped";
    }

    if (!page.properties || !("Name" in page.properties || "Folder" in page.properties)) {
      // 可能不在我们的库，或属性名不同
      try {
        const file = pageToDriveFile(page);
        if (!file.name && !file.folder) return "skipped";
        upsertIndexRow(driveFileToRow(file, isFolderMarker(file)));
        return "upserted";
      } catch {
        return "skipped";
      }
    }

    const file = pageToDriveFile(page);
    upsertIndexRow(driveFileToRow(file, isFolderMarker(file)));
    return "upserted";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Could not find|not found|404|object_not_found/i.test(msg)) {
      deleteIndexRow(pageIdNorm || pageId);
      return "deleted";
    }
    throw e;
  }
}

export async function removePageFromIndex(pageId: string) {
  deleteIndexRow(pageId);
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
    return (await withNotionRetry(
      () =>
        notion.pages.create({
          parent: { type: "data_source_id", data_source_id: dataSourceId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          properties: properties as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(children ? { children: children as any } : {}),
        }),
      "创建页面",
    )) as unknown as PageLike;
  }
  return (await withNotionRetry(
    () =>
      notion.pages.create({
        parent: { database_id: getDatabaseId() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties: properties as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(children ? { children: children as any } : {}),
      }),
    "创建页面",
  )) as unknown as PageLike;
}

/**
 * 在页面正文追加媒体块，便于在 Notion 内直接预览。
 * 与 File 属性共用同一 file_upload（官方支持一次上传多次挂接）。
 * 失败仅忽略，不影响网盘属性与下载。
 */
function mediaBlockChild(
  kind: FileKind,
  fileUploadId: string,
  caption?: string,
): Record<string, unknown> {
  const blockType = blockTypeForKind(kind);
  const captionRich = caption
    ? [{ type: "text" as const, text: { content: caption.slice(0, 2000) } }]
    : [];
  return {
    object: "block",
    type: blockType,
    [blockType]: {
      type: "file_upload",
      file_upload: { id: fileUploadId },
      ...(captionRich.length ? { caption: captionRich } : {}),
    },
  };
}

async function appendMediaPreview(
  notion: Client,
  pageId: string,
  kind: FileKind,
  fileUploadId: string,
  caption?: string,
): Promise<void> {
  try {
    await withNotionRetry(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notion.blocks.children.append as any)({
          block_id: pageId,
          children: [mediaBlockChild(kind, fileUploadId, caption)],
        }),
      "添加预览块",
      2,
    );
  } catch {
    // 类型不匹配或权限等：正文无预览不影响 File 属性
  }
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
  const id = normalizeNotionId(pageId) || pageId;
  const page = (await withNotionRetry(
    () => notion.pages.retrieve({ page_id: id }),
    "读取文件信息",
  )) as unknown as PageLike;
  return pageToDriveFile(page);
}

function toBlob(bytes: Uint8Array, contentType: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: contentType });
}

/**
 * Notion File Upload API 同时校验：
 * 1) content_type 白名单
 * 2) filename 的扩展名白名单（.ass / .exe / .iso 等会直接拒）
 * 官方：https://developers.notion.com/guides/data-apis/working-with-files-and-media
 *
 * 策略：上传时用「安全扩展名 + 合法 MIME」交给 Notion；
 * 网盘 Name / MIME 仍保存用户原始文件名与类型，下载后扩展名以 Name 为准。
 */
const NOTION_EXT_MIME: Array<{ re: RegExp; ext: string; mime: string }> = [
  { re: /\.zip$/i, ext: "zip", mime: "application/zip" },
  { re: /\.(gz|gzip)$/i, ext: "gz", mime: "application/gzip" },
  { re: /\.tar$/i, ext: "tar", mime: "application/x-tar" },
  { re: /\.7z$/i, ext: "7z", mime: "application/x-7z-compressed" },
  { re: /\.bz2$/i, ext: "bz2", mime: "application/x-bzip2" },
  { re: /\.rar$/i, ext: "rar", mime: "application/vnd.rar" },
  { re: /\.pdf$/i, ext: "pdf", mime: "application/pdf" },
  { re: /\.csv$/i, ext: "csv", mime: "text/csv" },
  { re: /\.json$/i, ext: "json", mime: "application/json" },
  { re: /\.(md|markdown)$/i, ext: "md", mime: "text/markdown" },
  { re: /\.(html|htm)$/i, ext: "html", mime: "text/html" },
  { re: /\.xml$/i, ext: "xml", mime: "application/xml" },
  { re: /\.css$/i, ext: "css", mime: "text/css" },
  { re: /\.(yaml|yml)$/i, ext: "yaml", mime: "text/yaml" },
  { re: /\.tsv$/i, ext: "tsv", mime: "text/tab-separated-values" },
  { re: /\.png$/i, ext: "png", mime: "image/png" },
  { re: /\.jpe?g$/i, ext: "jpg", mime: "image/jpeg" },
  { re: /\.gif$/i, ext: "gif", mime: "image/gif" },
  { re: /\.webp$/i, ext: "webp", mime: "image/webp" },
  { re: /\.svg$/i, ext: "svg", mime: "image/svg+xml" },
  { re: /\.bmp$/i, ext: "bmp", mime: "image/bmp" },
  { re: /\.ico$/i, ext: "ico", mime: "image/vnd.microsoft.icon" },
  { re: /\.avif$/i, ext: "avif", mime: "image/avif" },
  { re: /\.heic$/i, ext: "heic", mime: "image/heic" },
  { re: /\.tiff?$/i, ext: "tiff", mime: "image/tiff" },
  { re: /\.(mp4|m4v)$/i, ext: "mp4", mime: "video/mp4" },
  { re: /\.webm$/i, ext: "webm", mime: "video/webm" },
  { re: /\.mov$/i, ext: "mov", mime: "video/quicktime" },
  { re: /\.avi$/i, ext: "avi", mime: "video/x-msvideo" },
  { re: /\.(mpeg|mpg)$/i, ext: "mpeg", mime: "video/mpeg" },
  { re: /\.ogv$/i, ext: "ogv", mime: "video/ogg" },
  { re: /\.3gp$/i, ext: "3gp", mime: "video/3gpp" },
  { re: /\.3g2$/i, ext: "3g2", mime: "video/3gpp2" },
  { re: /\.flv$/i, ext: "flv", mime: "video/x-flv" },
  { re: /\.wmv$/i, ext: "wmv", mime: "video/x-ms-asf" },
  { re: /\.mkv$/i, ext: "mp4", mime: "video/mp4" },
  { re: /\.mp3$/i, ext: "mp3", mime: "audio/mpeg" },
  { re: /\.wav$/i, ext: "wav", mime: "audio/wav" },
  { re: /\.ogg$/i, ext: "ogg", mime: "audio/ogg" },
  { re: /\.m4a$/i, ext: "m4a", mime: "audio/mp4" },
  { re: /\.flac$/i, ext: "flac", mime: "audio/x-flac" },
  { re: /\.aac$/i, ext: "aac", mime: "audio/aac" },
  { re: /\.wma$/i, ext: "wma", mime: "audio/x-ms-wma" },
  { re: /\.opus$/i, ext: "ogg", mime: "audio/ogg" },
  { re: /\.midi?$/i, ext: "mid", mime: "audio/midi" },
  {
    re: /\.docx$/i,
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    re: /\.xlsx$/i,
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    re: /\.pptx$/i,
    ext: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  { re: /\.doc$/i, ext: "doc", mime: "application/msword" },
  { re: /\.xls$/i, ext: "xls", mime: "application/vnd.ms-excel" },
  { re: /\.ppt$/i, ext: "ppt", mime: "application/vnd.ms-powerpoint" },
  { re: /\.rtf$/i, ext: "rtf", mime: "application/rtf" },
  { re: /\.epub$/i, ext: "epub", mime: "application/epub+zip" },
  // 文本类（含字幕 .ass/.srt 等 → 当 txt 上传）
  {
    re: /\.(txt|log|ini|conf|js|ts|jsx|tsx|py|go|rs|java|c|cpp|h|sh|sql|ass|ssa|srt|vtt|lrc|sub|idx|nfo|cue|m3u|m3u8|pls)$/i,
    ext: "txt",
    mime: "text/plain",
  },
];

/** 返回交给 Notion 的 filename（安全扩展名）与 content_type */
function notionUploadIdentity(
  originalName: string,
  mimeType: string,
): { uploadName: string; contentType: string } {
  const lower = originalName.toLowerCase();
  const mt = (mimeType || "").toLowerCase().trim();

  for (const row of NOTION_EXT_MIME) {
    if (row.re.test(lower)) {
      // 已在白名单：尽量保留原扩展名（仅 mkv→mp4、ass→txt 等映射时改名）
      const m = lower.match(/(\.[a-z0-9]+)$/i);
      const origExt = m?.[1]?.slice(1).toLowerCase() || row.ext;
      const useOrig =
        origExt === row.ext ||
        // 允许的同族扩展
        (row.ext === "jpg" && (origExt === "jpeg" || origExt === "jpg")) ||
        (row.ext === "md" && (origExt === "md" || origExt === "markdown")) ||
        (row.ext === "html" && (origExt === "html" || origExt === "htm")) ||
        (row.ext === "yaml" && (origExt === "yaml" || origExt === "yml")) ||
        (row.ext === "gz" && (origExt === "gz" || origExt === "gzip")) ||
        (row.ext === "tiff" && (origExt === "tif" || origExt === "tiff")) ||
        (row.ext === "mp4" && (origExt === "mp4" || origExt === "m4v")) ||
        (row.ext === "mpeg" && (origExt === "mpeg" || origExt === "mpg")) ||
        (row.ext === "mid" && (origExt === "mid" || origExt === "midi"));
      const safeExt = useOrig ? origExt : row.ext;
      const base = originalName.replace(/\.[^./\\]+$/, "") || "file";
      // Notion 已支持的扩展直接用原名；映射类用 base.safeExt
      const uploadName = useOrig ? originalName : `${base}.${safeExt}`;
      return { uploadName: sanitizeUploadFilename(uploadName), contentType: row.mime };
    }
  }

  // MIME 别名
  if (mt === "application/x-zip-compressed" || mt === "application/x-zip") {
    return { uploadName: forceExt(originalName, "zip"), contentType: "application/zip" };
  }
  if (mt.startsWith("image/")) {
    return { uploadName: forceExt(originalName, "png"), contentType: "image/png" };
  }
  if (mt.startsWith("video/")) {
    return { uploadName: forceExt(originalName, "mp4"), contentType: "video/mp4" };
  }
  if (mt.startsWith("audio/")) {
    return { uploadName: forceExt(originalName, "mp3"), contentType: "audio/mpeg" };
  }
  if (mt.startsWith("text/") || mt === "application/json") {
    return { uploadName: forceExt(originalName, "txt"), contentType: "text/plain" };
  }

  // 未知扩展名（.exe .iso .ass 已在上面部分覆盖）：统一当 .bin 用 zip 容器 MIME 仍可能拒扩展
  // 用 .zip 扩展 + application/zip 最稳妥（内容仍是原字节）
  return {
    uploadName: forceExt(originalName, "bin.txt"),
    contentType: "text/plain",
  };
}

function sanitizeUploadFilename(name: string): string {
  // Notion filename ≤ 900 bytes；去掉路径分隔
  const base = name.replace(/[\\/]/g, "_").trim() || "file";
  // 过长时保留扩展名
  if (Buffer.byteLength(base, "utf8") <= 200) return base;
  const m = base.match(/(\.[^./\\]+)$/);
  const ext = m?.[1] || "";
  const stem = base.slice(0, Math.max(1, base.length - ext.length));
  let out = stem;
  while (Buffer.byteLength(out + ext, "utf8") > 200 && out.length > 1) {
    out = out.slice(0, -1);
  }
  return out + ext;
}

function forceExt(originalName: string, ext: string): string {
  const stem = originalName.replace(/\.[^./\\]+$/, "") || "file";
  // bin.txt → 双扩展表示“原二进制伪装为文本壳”
  if (ext.includes(".")) {
    return sanitizeUploadFilename(`${stem}.${ext}`);
  }
  return sanitizeUploadFilename(`${stem}.${ext}`);
}

/** Notion 侧上传进度（0–1），供 API 流式回报 */
export type UploadProgress = {
  phase: "create" | "send" | "complete" | "page";
  /** 0–1，仅服务器→Notion 阶段 */
  ratio: number;
  message?: string;
  part?: number;
  parts?: number;
};

export type UploadProgressHandler = (p: UploadProgress) => void;

async function uploadBinary(
  notion: Client,
  uploadName: string,
  contentType: string,
  bytes: Uint8Array,
  onProgress?: UploadProgressHandler,
) {
  const size = bytes.byteLength;

  try {
    if (size <= SINGLE_PART_LIMIT) {
      onProgress?.({ phase: "create", ratio: 0.05, message: "创建上传任务" });
      const created = await withNotionRetry(
        () =>
          notion.fileUploads.create({
            mode: "single_part",
            filename: uploadName,
            content_type: contentType,
          }),
        "创建上传",
      );

      onProgress?.({ phase: "send", ratio: 0.15, message: "发送到 Notion" });
      await withNotionRetry(
        () =>
          notion.fileUploads.send({
            file_upload_id: created.id,
            file: {
              filename: uploadName,
              data: toBlob(bytes, contentType),
            },
          }),
        "发送文件",
      );
      onProgress?.({ phase: "send", ratio: 0.88, message: "已发送到 Notion" });

      return created.id;
    }

    const numberOfParts = Math.ceil(size / PART_SIZE);
    onProgress?.({
      phase: "create",
      ratio: 0.05,
      message: `创建分片上传（${numberOfParts} 片）`,
      parts: numberOfParts,
    });
    const created = await withNotionRetry(
      () =>
        notion.fileUploads.create({
          mode: "multi_part",
          number_of_parts: numberOfParts,
          filename: uploadName,
          content_type: contentType,
        }),
      "创建分片上传",
    );

    for (let i = 0; i < numberOfParts; i++) {
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, size);
      const part = bytes.subarray(start, end);
      onProgress?.({
        phase: "send",
        ratio: 0.05 + (i / numberOfParts) * 0.83,
        message: `发送分片 ${i + 1}/${numberOfParts}`,
        part: i + 1,
        parts: numberOfParts,
      });
      await withNotionRetry(
        () =>
          notion.fileUploads.send({
            file_upload_id: created.id,
            file: {
              filename: uploadName,
              data: toBlob(part, contentType),
            },
            part_number: String(i + 1),
          }),
        `发送分片 ${i + 1}/${numberOfParts}`,
      );
      // create 5% → send 完成后累计到 88%
      onProgress?.({
        phase: "send",
        ratio: 0.05 + ((i + 1) / numberOfParts) * 0.83,
        message: `已发送分片 ${i + 1}/${numberOfParts}`,
        part: i + 1,
        parts: numberOfParts,
      });
    }

    onProgress?.({ phase: "complete", ratio: 0.9, message: "合并分片" });
    await withNotionRetry(
      () =>
        notion.fileUploads.complete({
          file_upload_id: created.id,
        }),
      "完成上传",
    );
    onProgress?.({ phase: "complete", ratio: 0.93, message: "分片已合并" });

    return created.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/extension|content type|not supported|validation/i.test(msg)) {
      throw new Error(
        `Notion 拒绝上传（上传名 ${uploadName} / ${contentType}）。原文：${msg}`,
      );
    }
    throw err;
  }
}

export type UploadFileResult = {
  file: DriveFile;
  /** 同目录已存在同名同大小，未实际上传 */
  skipped?: boolean;
};

/** 服务端上传：浏览器只连本服务，密钥不离开服务器 */
export async function uploadFile(input: {
  file: File | Blob;
  filename: string;
  folder?: string;
  onProgress?: UploadProgressHandler;
}): Promise<UploadFileResult> {
  const notion = getNotionClient();
  // 网盘显示名 = 用户原始文件名（含 .ass 等）
  const displayName = input.filename;
  const folder = sanitizeFolder(input.folder);
  const size = input.file.size;
  const onProgress = input.onProgress;

  // 同目录 + 同名 + 同大小 → 视为已存在，跳过上传
  const existing = findIndexFileByName(folder, displayName, size);
  if (existing) {
    return { file: existing, skipped: true };
  }

  const limit = await getWorkspaceUploadLimit();
  assertWithinUploadLimit(size, limit, formatBytes);

  const browserMime = String((input.file as File).type || "").trim();
  const lookedUp = String(mime.lookup(displayName) || "");
  const rawMime = browserMime || lookedUp || "application/octet-stream";
  // 交给 Notion 的安全扩展名 + MIME（.ass → .txt / text/plain）
  const { uploadName, contentType: uploadMime } = notionUploadIdentity(displayName, rawMime);
  const kind = detectKind(rawMime || uploadMime, displayName);

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  // File 属性 + 正文媒体块共用同一 file_upload（官方支持复用）
  // binary 进度 0–0.93 映射到整体 0–0.9
  const fileUploadId = await uploadBinary(
    notion,
    uploadName,
    uploadMime,
    bytes,
    onProgress
      ? (p) =>
          onProgress({
            ...p,
            ratio: Math.min(0.9, p.ratio),
          })
      : undefined,
  );

  // File 属性里的 name 尽量用原始名，便于下载；不支持时 Notion 会用 upload 名
  const filePropName = displayName.length <= 100 ? displayName : uploadName;

  onProgress?.({ phase: "page", ratio: 0.94, message: "写入网盘索引" });
  const properties: Record<string, unknown> = {
    Name: { title: richText(displayName) },
    Folder: { rich_text: richText(folder) },
    Size: { number: size },
    MIME: {
      rich_text: richText(
        rawMime === "application/octet-stream" ? uploadMime : rawMime,
      ),
    },
    Type: { select: { name: kind } },
    File: {
      files: [
        {
          type: "file_upload",
          file_upload: { id: fileUploadId },
          name: filePropName,
        },
      ],
    },
  };

  let page: PageLike;
  try {
    page = await createPage(notion, properties);
  } catch (err) {
    // binary 已上传但建页失败：无法可靠删除 file_upload，错误信息提示用户
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `文件已传到 Notion 但写入网盘失败（可稍后点「刷新索引」）：${msg}`,
    );
  }

  let pageId = page.id;
  try {
    onProgress?.({ phase: "page", ratio: 0.96, message: "添加 Notion 预览" });
    await appendMediaPreview(notion, pageId, kind, fileUploadId, displayName);
    onProgress?.({ phase: "page", ratio: 0.98, message: "更新列表" });
    const file = await getFile(pageId);
    // 保证列表显示原始文件名（getFile 若读到别的 name 也覆盖）
    const normalized: DriveFile = { ...file, name: displayName || file.name };
    upsertIndexRow(driveFileToRow(normalized, isFolderMarker(normalized)));
    onProgress?.({ phase: "page", ratio: 1, message: "完成" });
    return { file: normalized, skipped: false };
  } catch (err) {
    // 页面已建但后续失败：尽量把已有页写入索引，避免孤儿；失败则尝试归档孤儿页
    try {
      const partial = await getFile(pageId);
      const normalized: DriveFile = {
        ...partial,
        name: displayName || partial.name,
      };
      upsertIndexRow(driveFileToRow(normalized, isFolderMarker(normalized)));
      onProgress?.({ phase: "page", ratio: 1, message: "完成（预览可选）" });
      return { file: normalized, skipped: false };
    } catch {
      try {
        await withNotionRetry(
          () =>
            notion.pages.update({
              page_id: pageId,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...({ in_trash: true } as any),
            }),
          "清理失败上传页",
          1,
        );
      } catch {
        try {
          await notion.pages.update({ page_id: pageId, archived: true });
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    const decoded = decodeURIComponent(last).split("?")[0].trim();
    if (decoded && decoded.includes(".")) return decoded.slice(0, 200);
  } catch {
    // ignore
  }
  return `import-${Date.now()}.bin`;
}

/** 进程内锁：同一 job 只 finalize 一次（防 Webhook + 轮询双建页） */
const importFinalizeLocks = new Map<string, Promise<ImportJob | null>>();

/** 将已 uploaded 的 file_upload 落成网盘页面 + 索引 */
async function finalizeUploadedImport(
  job: ImportJob,
  contentLengthHint = 0,
): Promise<DriveFile> {
  // 已完成则复用，避免并发路径再 createPage
  const latest = getImportJob(job.id);
  if (latest?.status === "done" && latest.file) {
    return latest.file;
  }
  const existingByName = findIndexFileByName(job.folder, job.displayName);
  if (existingByName) {
    return existingByName;
  }

  const notion = getNotionClient();
  let contentLength = contentLengthHint || job.contentLength || 0;

  try {
    const info = await withNotionRetry(
      () => notion.fileUploads.retrieve({ file_upload_id: job.fileUploadId }),
      "查询导入状态",
      3,
    );
    const st = (info as { status?: string }).status;
    if (st === "failed" || st === "expired") {
      const detail =
        (info as { file_import_result?: { error?: { message?: string } } })
          ?.file_import_result?.error?.message || st;
      throw new Error(`Notion 导入失败：${detail}`);
    }
    if (st && st !== "uploaded") {
      throw new Error(`Notion 导入尚未完成（${st}）`);
    }
    const len = (info as { content_length?: number | null }).content_length;
    if (typeof len === "number" && len > 0) contentLength = len;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/导入失败|尚未完成/.test(msg)) throw e;
    // retrieve 偶发失败时仍尝试建页
  }

  if (!contentLength) {
    try {
      const head = await fetch(job.url, { method: "HEAD", redirect: "follow" });
      const cl = head.headers.get("content-length");
      if (cl && Number(cl) > 0) contentLength = Number(cl);
    } catch {
      // ignore
    }
  }

  // createPage 前再查一次（锁内另一路径可能刚写完）
  const again = getImportJob(job.id);
  if (again?.status === "done" && again.file) return again.file;
  const named = findIndexFileByName(job.folder, job.displayName);
  if (named) return named;

  const filePropName =
    job.displayName.length <= 100 ? job.displayName : job.uploadName;
  const properties: Record<string, unknown> = {
    Name: { title: richText(job.displayName) },
    Folder: { rich_text: richText(job.folder) },
    Size: { number: contentLength || 0 },
    MIME: {
      rich_text: richText(
        job.rawMime === "application/octet-stream" ? job.uploadMime : job.rawMime,
      ),
    },
    Type: { select: { name: job.kind } },
    File: {
      files: [
        {
          type: "file_upload",
          file_upload: { id: job.fileUploadId },
          name: filePropName,
        },
      ],
    },
  };

  let page: PageLike;
  try {
    page = await createPage(notion, properties);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`外链已导入 Notion 但写入网盘失败：${msg}`);
  }

  const pageId = page.id;
  try {
    await appendMediaPreview(notion, pageId, job.kind, job.fileUploadId, job.displayName);
  } catch {
    // 预览块失败不阻断
  }

  let file: DriveFile;
  try {
    file = await getFile(pageId);
  } catch (err) {
    // 页已存在：构造最小记录写索引，避免孤儿页
    const fallback: DriveFile = {
      id: normalizeNotionId(pageId),
      name: job.displayName,
      size: contentLength || 0,
      mimeType: job.rawMime || job.uploadMime,
      kind: job.kind,
      folder: job.folder,
      createdTime: new Date().toISOString(),
      lastEditedTime: new Date().toISOString(),
    };
    upsertIndexRow(driveFileToRow(fallback, isFolderMarker(fallback)));
    return fallback;
  }

  const finalSize =
    (typeof contentLength === "number" && contentLength > 0
      ? contentLength
      : file.size) || 0;

  if (finalSize > 0 && (!file.size || file.size === 0)) {
    try {
      await withNotionRetry(
        () =>
          notion.pages.update({
            page_id: pageId,
            properties: { Size: { number: finalSize } },
          }),
        "更新文件大小",
        2,
      );
    } catch {
      // ignore
    }
  }

  const normalized: DriveFile = {
    ...file,
    name: job.displayName || file.name,
    size: finalSize,
  };
  upsertIndexRow(driveFileToRow(normalized, isFolderMarker(normalized)));
  return normalized;
}

/**
 * 创建外链导入任务（不阻塞等待 Notion 拉完文件）。
 * - 有 Webhook 时：file_upload.completed 触发 finalize
 * - 无 Webhook：后台轮询兜底；前端轮询 job 状态
 */
export async function startImportFromUrl(input: {
  url: string;
  filename?: string;
  folder?: string;
}): Promise<
  | { mode: "skipped"; file: DriveFile; jobId?: string }
  | { mode: "async"; jobId: string; status: string }
> {
  const rawUrl = input.url.trim();
  if (!/^https:\/\//i.test(rawUrl)) {
    throw new Error("请使用 https:// 开头的公网直链（Notion 无法访问 http / 内网地址）");
  }

  const displayName =
    (input.filename || filenameFromUrl(rawUrl)).trim() || filenameFromUrl(rawUrl);
  const folder = sanitizeFolder(input.folder);

  const existing = findIndexFileByName(folder, displayName);
  if (existing) {
    return { mode: "skipped", file: existing };
  }

  const lookedUp = String(mime.lookup(displayName) || "");
  const rawMime = lookedUp || "application/octet-stream";
  const { uploadName, contentType: uploadMime } = notionUploadIdentity(
    displayName,
    rawMime,
  );
  const kind = detectKind(rawMime || uploadMime, displayName);
  const notion = getNotionClient();

  let created;
  try {
    created = await withNotionRetry(
      () =>
        notion.fileUploads.create({
          mode: "external_url",
          filename: uploadName,
          content_type: uploadMime,
          external_url: rawUrl,
        }),
      "外链导入",
      5,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/headers of the external URL|publicly accessible|Failed to fetch/i.test(msg)) {
      throw new Error(
        "Notion 无法访问该链接（校验响应头失败）。常见原因：链接需登录/Cookie、防盗链、签名过期、或 Notion 服务器所在网络访问不到该站点。请换可公网匿名下载的 https 直链，或本机下载后用「上传文件」。",
      );
    }
    throw err;
  }

  const fileUploadId = created.id;
  const initialStatus = (created as { status?: string }).status || "pending";
  let contentLength =
    typeof (created as { content_length?: number }).content_length === "number"
      ? (created as { content_length: number }).content_length
      : 0;

  const job = createImportJob({
    fileUploadId,
    url: rawUrl,
    displayName,
    uploadName,
    folder,
    kind,
    rawMime,
    uploadMime,
    contentLength: contentLength || undefined,
    status: initialStatus === "uploaded" ? "uploaded" : "pending",
  });

  if (initialStatus === "uploaded") {
    const finished = await advanceImportJob(job.id, { contentLength });
    if (finished?.status === "error") {
      throw new Error(finished.error || "导入失败");
    }
    return {
      mode: "async",
      jobId: job.id,
      status: finished?.status === "done" ? "done" : "pending",
    };
  }

  // 后台轮询兜底（无 Webhook 或 Webhook 延迟时仍能完成）
  void pollImportJobUntilDone(job.id).catch(() => {
    // status already written
  });

  return { mode: "async", jobId: job.id, status: "pending" };
}

/** 兼容旧调用：阻塞等到完成 */
export async function importFromUrl(input: {
  url: string;
  filename?: string;
  folder?: string;
}): Promise<UploadFileResult> {
  const started = await startImportFromUrl(input);
  if (started.mode === "skipped") {
    return { file: started.file, skipped: true };
  }
  const result = await waitImportJob(started.jobId, 15 * 60 * 1000);
  if (result.status === "skipped" && result.file) {
    return { file: result.file, skipped: true };
  }
  if (result.status === "done" && result.file) {
    return { file: result.file, skipped: false };
  }
  throw new Error(result.error || "导入失败");
}

export async function getImportJobStatus(jobId: string) {
  // 查询时顺带探测一次 Notion，减少 Webhook 缺失时的等待
  await refreshImportJobFromNotion(jobId).catch(() => null);
  const job = getImportJob(jobId);
  if (!job) return null;
  return publicImportJob(job);
}

/** Webhook / 轮询：推进任务到终态（同 job 串行，避免建出两个同名页） */
export async function advanceImportJob(
  jobId: string,
  opts?: { forceFail?: string; contentLength?: number },
): Promise<ImportJob | null> {
  const inflight = importFinalizeLocks.get(jobId);
  if (inflight) return inflight;

  const run = (async (): Promise<ImportJob | null> => {
    const job = getImportJob(jobId);
    if (!job) return null;
    if (job.status === "done" || job.status === "skipped" || job.status === "error") {
      return job;
    }

    if (opts?.forceFail) {
      return updateImportJob(job.id, {
        status: "error",
        error: opts.forceFail,
      });
    }

    // 占位：其它路径看到 finalizing 时等锁即可，勿再 createPage
    updateImportJob(job.id, { status: "finalizing", error: undefined });

    try {
      const file = await finalizeUploadedImport(job, opts?.contentLength || 0);
      // 若复用了已有同名文件，仍标 done（不再建页）
      return updateImportJob(job.id, {
        status: "done",
        file,
        contentLength: file.size,
        error: undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "导入失败";
      if (/尚未完成/.test(msg)) {
        return updateImportJob(job.id, { status: "pending", error: undefined });
      }
      return updateImportJob(job.id, { status: "error", error: msg });
    }
  })().finally(() => {
    importFinalizeLocks.delete(jobId);
  });

  importFinalizeLocks.set(jobId, run);
  return run;
}

export async function advanceImportJobByUploadId(
  fileUploadId: string,
  opts?: { forceFail?: string; contentLength?: number },
) {
  const job = getImportJobByUploadId(fileUploadId);
  if (!job) return null;
  return advanceImportJob(job.id, opts);
}

async function refreshImportJobFromNotion(jobId: string) {
  const job = getImportJob(jobId);
  if (!job || isImportTerminal(job.status)) {
    return job;
  }
  // finalizing：有进程内锁则等；无锁（重启残留）则允许继续推进
  if (job.status === "finalizing") {
    const wait = importFinalizeLocks.get(jobId);
    if (wait) return wait;
  }
  const notion = getNotionClient();
  const info = await withNotionRetry(
    () => notion.fileUploads.retrieve({ file_upload_id: job.fileUploadId }),
    "查询导入状态",
    2,
  );
  const status = (info as { status?: string }).status || "pending";
  const len = (info as { content_length?: number | null }).content_length;
  const contentLength =
    typeof len === "number" && len > 0 ? len : job.contentLength;

  if (status === "uploaded") {
    return advanceImportJob(job.id, { contentLength });
  }
  if (status === "failed" || status === "expired") {
    const detail =
      (info as { file_import_result?: { error?: { message?: string } } })
        ?.file_import_result?.error?.message || status;
    return updateImportJob(job.id, {
      status: "error",
      error: `Notion 导入失败：${detail}`,
      contentLength,
    });
  }
  if (contentLength && contentLength !== job.contentLength) {
    return updateImportJob(job.id, { contentLength });
  }
  return job;
}

function isImportTerminal(status: string | undefined) {
  return status === "done" || status === "error" || status === "skipped";
}

async function pollImportJobUntilDone(jobId: string) {
  // 最多约 30 分钟
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 2000 + Math.min(i, 30) * 200));
    const job = await refreshImportJobFromNotion(jobId);
    if (!job) return;
    if (isImportTerminal(job.status)) return;
  }
  const cur = getImportJob(jobId);
  if (cur && (cur.status === "pending" || cur.status === "uploaded")) {
    updateImportJob(jobId, {
      status: "error",
      error: "Notion 导入超时，请确认链接可公网访问后重试",
    });
  }
}

async function waitImportJob(jobId: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await refreshImportJobFromNotion(jobId);
    if (!job) throw new Error("导入任务不存在");
    if (isImportTerminal(job.status)) {
      return publicImportJob(job);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Notion 导入超时，请确认链接可公网访问后重试");
}

export async function deleteFile(pageId: string): Promise<void> {
  const notion = getNotionClient();
  const id = normalizeNotionId(pageId) || pageId;
  try {
    await withNotionRetry(
      () =>
        notion.pages.update({
          page_id: id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ in_trash: true } as any),
        }),
      "删除文件",
    );
  } catch {
    await withNotionRetry(
      () =>
        notion.pages.update({
          page_id: id,
          archived: true,
        }),
      "归档文件",
    );
  }
  deleteIndexRow(id);
  try {
    const { deleteThumb } = await import("./thumb");
    deleteThumb(id);
  } catch {
    // ignore
  }
}

export async function renameFile(pageId: string, name: string): Promise<DriveFile> {
  const nextName = name.trim();
  if (!nextName) throw new Error("文件名不能为空");
  const id = normalizeNotionId(pageId) || pageId;

  // 先取当前文件，确定所在目录
  const current = await getFile(id);
  if (current.name === nextName) return current;

  // 同目录已有同名（不含自己）→ 拒绝
  const clash = findIndexFileByName(current.folder, nextName);
  if (clash && !sameNotionId(clash.id, id)) {
    throw new Error(`当前目录已存在「${nextName}」`);
  }

  const notion = getNotionClient();
  await withNotionRetry(
    () =>
      notion.pages.update({
        page_id: id,
        properties: {
          Name: { title: richText(nextName) },
        },
      }),
    "重命名",
  );
  const file = await getFile(id);
  // 保证显示名与请求一致
  const normalized: DriveFile = { ...file, name: nextName };
  upsertIndexRow(driveFileToRow(normalized, isFolderMarker(normalized)));
  return normalized;
}

export async function moveFile(pageId: string, folder: string): Promise<DriveFile> {
  const target = sanitizeFolder(folder);
  const id = normalizeNotionId(pageId) || pageId;
  const current = await getFile(id);
  if (current.folder === target) return current;

  // 目标目录已有同名 → 拒绝
  const clash = findIndexFileByName(target, current.name);
  if (clash && !sameNotionId(clash.id, id)) {
    throw new Error(`目标目录已存在「${current.name}」`);
  }

  const notion = getNotionClient();
  await withNotionRetry(
    () =>
      notion.pages.update({
        page_id: id,
        properties: {
          Folder: { rich_text: richText(target) },
        },
      }),
    "移动文件",
  );
  const file = await getFile(id);
  upsertIndexRow(driveFileToRow(file, isFolderMarker(file)));
  return file;
}

const DRIVE_REQUIRED_PROPS = ["Name", "Folder", "Size", "MIME", "Type", "File"] as const;

function driveSchemaPropertyDefs(): Record<string, Record<string, unknown>> {
  return {
    Name: { title: {} },
    Folder: { rich_text: {} },
    Size: { number: { format: "number" } },
    MIME: { rich_text: {} },
    Type: {
      select: {
        options: [
          { name: "image", color: "blue" },
          { name: "video", color: "purple" },
          { name: "audio", color: "pink" },
          { name: "pdf", color: "red" },
          { name: "file", color: "gray" },
        ],
      },
    },
    File: { files: {} },
  };
}

async function readSchemaPropertyNames(notion: Client): Promise<{
  props: string[];
  source: string;
  dataSourceId: string | null;
}> {
  let props: string[] = [];
  let source = "unknown";
  let dataSourceId = await getDataSourceId(notion);

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

  if (!props.length) {
    try {
      const db = await notion.databases.retrieve({ database_id: getDatabaseId() });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyDb = db as any;
      props = Object.keys(anyDb.properties || {});
      if (props.length) source = "database";
      if (!dataSourceId && Array.isArray(anyDb.data_sources) && anyDb.data_sources[0]?.id) {
        dataSourceId = anyDb.data_sources[0].id;
      }
      if (!props.length && dataSourceId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ds = await (notion as any).dataSources.retrieve({
            data_source_id: dataSourceId,
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

  return { props, source, dataSourceId };
}

/** 补齐缺失属性（Name 为 title 通常已存在，只补其它列） */
async function repairMissingSchemaProperties(
  notion: Client,
  dataSourceId: string | null,
  missing: string[],
): Promise<{ repaired: string[]; error?: string }> {
  const toAdd = missing.filter((m) => m !== "Name");
  if (!toAdd.length) return { repaired: [] };
  if (!dataSourceId) {
    return { repaired: [], error: "无法定位 data source，请手动补全属性" };
  }

  const defs = driveSchemaPropertyDefs();
  const properties: Record<string, unknown> = {};
  for (const name of toAdd) {
    if (defs[name]) properties[name] = defs[name];
  }
  if (!Object.keys(properties).length) return { repaired: [] };

  try {
    await withNotionRetry(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notion as any).dataSources.update({
          data_source_id: dataSourceId,
          properties,
        }),
      "补全数据库属性",
      2,
    );
    return { repaired: toAdd };
  } catch (e) {
    return {
      repaired: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function ensureDatabaseSchema(options?: {
  repair?: boolean;
}): Promise<{
  ok: boolean;
  message: string;
  properties: string[];
  repaired?: string[];
  missing?: string[];
}> {
  const notion = getNotionClient();
  const required = [...DRIVE_REQUIRED_PROPS];
  let { props, source, dataSourceId } = await readSchemaPropertyNames(notion);

  // 本地索引兜底
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

  let missing = required.filter((r) => !props.includes(r));
  let repaired: string[] = [];

  if (missing.length && options?.repair !== false) {
    const fix = await repairMissingSchemaProperties(notion, dataSourceId, missing);
    repaired = fix.repaired;
    if (repaired.length) {
      const again = await readSchemaPropertyNames(notion);
      props = again.props;
      source = again.source || source;
      dataSourceId = again.dataSourceId || dataSourceId;
      missing = required.filter((r) => !props.includes(r));
    } else if (fix.error && missing.length) {
      // 继续下面的降级逻辑
    }
  }

  if (missing.length) {
    try {
      const probe = await queryPages(notion, null, null, 1);
      if (probe && Array.isArray(probe.results)) {
        return {
          ok: true,
          message: `数据库可访问（${source} 未完整返回 Schema，缺: ${missing.join(", ")}；列表功能正常可忽略）`,
          properties: props,
          missing,
          repaired,
        };
      }
    } catch {
      // fall through
    }
    return {
      ok: false,
      message: `数据库缺少属性: ${missing.join(", ")}。可在后台点「修复 Schema」，或按 README 手动创建。`,
      properties: props,
      missing,
      repaired,
    };
  }

  return {
    ok: true,
    message: repaired.length
      ? `Schema 已修复并补全：${repaired.join(", ")}（${source}）`
      : `数据库 Schema 正常（${source}）`,
    properties: props,
    repaired,
  };
}

/**
 * 自动创建网盘数据库（工作区根或指定页面下），并写入 NOTION_DATABASE_ID。
 * 需要 Integration 具备创建内容权限。
 */
export async function createDriveDatabase(input?: {
  parentPageId?: string;
  title?: string;
}): Promise<{
  databaseId: string;
  dataSourceId: string | null;
  title: string;
}> {
  const notion = getNotionClient();
  const title = (input?.title || "NotionPan").trim() || "NotionPan";
  const parentPageId = input?.parentPageId?.replace(/\s/g, "") || "";

  const parent = parentPageId
    ? { type: "page_id" as const, page_id: parentPageId }
    : { type: "workspace" as const, workspace: true as const };

  const defs = driveSchemaPropertyDefs();
  // Name 作为 title：创建时用 title 字段；properties 里不要重复 Name 若 API 用 initial_data_source
  const properties: Record<string, unknown> = {
    Name: defs.Name,
    Folder: defs.Folder,
    Size: defs.Size,
    MIME: defs.MIME,
    Type: defs.Type,
    File: defs.File,
  };

  let created: {
    id?: string;
    data_sources?: Array<{ id?: string }>;
  };
  try {
    created = (await withNotionRetry(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notion as any).databases.create({
          parent,
          title: richText(title),
          initial_data_source: { properties },
        }),
      "创建网盘数据库",
      2,
    )) as typeof created;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/workspace|parent|permission|unauthorized|restricted/i.test(msg) && !parentPageId) {
      throw new Error(
        `无法在工作区根创建数据库：${msg}。请传入 parentPageId（在 Notion 建一页，把 Integration 加到该页），或手动建库。`,
      );
    }
    throw e;
  }

  const databaseId = String(created.id || "").replace(/-/g, "");
  if (!databaseId) throw new Error("创建数据库成功但未返回 ID");

  let dataSourceId =
    created.data_sources?.[0]?.id?.replace(/-/g, "") || null;

  // 写入运行时 env
  const { writeEnvConfig, softReloadEnv } = await import("./runtime-env");
  writeEnvConfig({
    NOTION_DATABASE_ID: databaseId,
    ...(dataSourceId ? { NOTION_DATA_SOURCE_ID: dataSourceId } : {}),
  });
  softReloadEnv();

  // 再探测 data source
  if (!dataSourceId) {
    try {
      const ds = await getDataSourceId(getNotionClient());
      dataSourceId = ds?.replace(/-/g, "") || null;
      if (dataSourceId) {
        writeEnvConfig({ NOTION_DATA_SOURCE_ID: dataSourceId });
        softReloadEnv();
      }
    } catch {
      // ignore
    }
  }

  return { databaseId, dataSourceId, title };
}
