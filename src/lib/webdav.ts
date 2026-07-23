import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import {
  createFolder,
  deleteFile,
  getFile,
  listAllFolders,
  listFiles,
  moveFile,
  renameFile,
  uploadFile,
  uploadFileFromPath,
} from "./drive";
import {
  findFolderMarker,
  findIndexFileByName,
  listIndexRowsUnder,
} from "./db";
import { assertWithinUploadLimit, getWorkspaceUploadLimit } from "./notion";
import type { DriveFile } from "./types";
import {
  formatBytes,
  joinFolder,
  parentFolder,
  sanitizeFolder,
} from "./utils";

const DAV_NS = "DAV:";
const FOLDER_MARKER = ".folder";

/** 对外挂载路径（客户端仍用 /webdav；内部实现在 /api/webdav） */
export function webDavBasePath(): string {
  return "/webdav";
}

export function sanitizeDavPath(path: string): string {
  // 与网页 folder 一致；额外剥 webdav 前缀防污染
  let p = (path || "/").replace(/\\/g, "/").trim() || "/";
  p = p.replace(/^\/+(?:api\/)?webdav/i, "") || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  return sanitizeFolder(p);
}

/** 从 /webdav 或 /webdav/foo/bar 解析逻辑路径（不以 / 结尾表示文件） */
export function parseWebDavPath(pathname: string): {
  path: string;
  isCollectionHint: boolean;
} {
  let p = pathname || "/";
  // 去掉 /webdav 前缀
  if (p === "/webdav" || p === "/webdav/") {
    return { path: "/", isCollectionHint: true };
  }
  if (p.startsWith("/webdav/")) {
    p = p.slice("/webdav".length);
  }
  if (!p.startsWith("/")) p = `/${p}`;
  const isCollectionHint = p.endsWith("/") && p !== "/";
  // 解码 URI
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep
  }
  p = sanitizeFolder(p.replace(/\/+$/, "") || "/");
  if (isCollectionHint && p === "/") {
    return { path: "/", isCollectionHint: true };
  }
  return { path: p, isCollectionHint };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hrefFor(path: string, isDir: boolean): string {
  const base = webDavBasePath();
  if (path === "/" || path === "") {
    return `${base}/`;
  }
  const segs = path.split("/").filter(Boolean).map(encodeURIComponent);
  const h = `${base}/${segs.join("/")}`;
  return isDir ? `${h}/` : h;
}

function rfc1123(iso?: string | null): string {
  if (!iso) return new Date().toUTCString();
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toUTCString() : new Date().toUTCString();
}

function etagFor(file: DriveFile): string {
  return `"${file.id.replace(/"/g, "")}-${file.lastEditedTime || file.size}"`;
}

function propstatOk(inner: string): string {
  return `<D:propstat>
  <D:prop>
${inner}
  </D:prop>
  <D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>`;
}

function propstat404(names: string[]): string {
  if (!names.length) return "";
  return `<D:propstat>
  <D:prop>
${names.map((n) => `    <D:${n}/>`).join("\n")}
  </D:prop>
  <D:status>HTTP/1.1 404 Not Found</D:status>
</D:propstat>`;
}

function resourceXml(
  path: string,
  isDir: boolean,
  props: {
    displayName: string;
    contentLength?: number;
    contentType?: string;
    lastModified?: string;
    etag?: string;
    creationDate?: string;
  },
): string {
  const inner: string[] = [];
  inner.push(`    <D:displayname>${escapeXml(props.displayName)}</D:displayname>`);
  inner.push(
    isDir
      ? `    <D:resourcetype><D:collection/></D:resourcetype>`
      : `    <D:resourcetype/>`,
  );
  if (!isDir) {
    if (typeof props.contentLength === "number") {
      inner.push(
        `    <D:getcontentlength>${props.contentLength}</D:getcontentlength>`,
      );
    }
    if (props.contentType) {
      inner.push(
        `    <D:getcontenttype>${escapeXml(props.contentType)}</D:getcontenttype>`,
      );
    }
    if (props.etag) {
      inner.push(`    <D:getetag>${escapeXml(props.etag)}</D:getetag>`);
    }
  }
  if (props.lastModified) {
    inner.push(
      `    <D:getlastmodified>${escapeXml(rfc1123(props.lastModified))}</D:getlastmodified>`,
    );
  }
  if (props.creationDate) {
    inner.push(
      `    <D:creationdate>${escapeXml(new Date(props.creationDate).toISOString())}</D:creationdate>`,
    );
  }
  // 权限标记（宽松）
  inner.push(`    <D:supportedlock/>`);

  return `<D:response>
  <D:href>${escapeXml(hrefFor(path, isDir))}</D:href>
  ${propstatOk(inner.join("\n"))}
</D:response>`;
}

/** 解析路径：是文件夹还是文件 */
export async function resolvePath(path: string): Promise<
  | { kind: "root" }
  | { kind: "folder"; path: string }
  | { kind: "file"; file: DriveFile }
  | { kind: "missing" }
> {
  const p = sanitizeDavPath(path);
  if (p === "/") return { kind: "root" };

  // 1) 有 .folder 占位 → 一定是目录（含空文件夹）
  const marker = findFolderMarker(p);
  if (marker) {
    return { kind: "folder", path: p };
  }

  // 2) 已知文件夹路径（含子路径前缀展开）
  const allFolders = await listAllFolders();
  if (allFolders.includes(p)) {
    return { kind: "folder", path: p };
  }

  // 3) 该路径下是否已有任何子文件/子目录（无 marker 的隐式目录）
  try {
    const under = listIndexRowsUnder(p);
    if (under.some((r) => r.folder === p || r.folder.startsWith(`${p}/`))) {
      return { kind: "folder", path: p };
    }
  } catch {
    // ignore
  }

  const parent = parentFolder(p);
  const name = p.split("/").filter(Boolean).pop() || "";
  if (!name) return { kind: "missing" };

  // 4) 父目录列表中的子文件夹名
  try {
    const { folders, files } = await listFiles({ folder: parent });
    if (folders.includes(name)) {
      return { kind: "folder", path: p };
    }
    const file = files.find((f) => f.name === name);
    if (file) return { kind: "file", file };
  } catch {
    // ignore
  }

  // 5) 索引直接查文件
  const byName = findIndexFileByName(parent, name);
  if (byName) return { kind: "file", file: byName };

  return { kind: "missing" };
}

export async function handleOptions(): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: {
      Allow:
        "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY",
      DAV: "1, 2",
      "MS-Author-Via": "DAV",
      "Accept-Ranges": "bytes",
    },
  });
}

export async function handlePropfind(
  req: NextRequest,
  path: string,
): Promise<Response> {
  const depth = (req.headers.get("depth") || "1").toLowerCase();
  // 调用方传入的 path 即客户端请求路径，先规范化
  const requestPath = sanitizeDavPath(path);

  let resolved = await resolvePath(requestPath);

  /**
   * OpenList 建夹：往往只发 PROPFIND Depth:0 做 Stat，404 后不发 MKCOL 而是整段失败。
   * 兼容：Depth:0 + 路径「不像文件名」时自动 MKCOL，再回 207。
   * 带扩展名（ab.txt / a.mkv）绝不自动建夹 → 保持 404，走 PUT。
   */
  if (resolved.kind === "missing" && (depth === "0" || depth === "")) {
    const baseName = requestPath.split("/").filter(Boolean).pop() || "";
    const looksLikeFile =
      // 普通扩展名：file.txt、video.mkv
      (baseName.includes(".") &&
        !baseName.startsWith(".") &&
        /\.[a-zA-Z0-9]{1,12}$/.test(baseName)) ||
      // 双扩展等：file.tar.gz
      /\.[a-zA-Z0-9]{1,8}\.[a-zA-Z0-9]{1,8}$/.test(baseName);

    if (!looksLikeFile && requestPath !== "/" && baseName.length > 0) {
      const parent = parentFolder(requestPath);
      let parentOk = parent === "/";
      if (!parentOk) {
        const pr = await resolvePath(parent);
        parentOk = pr.kind === "folder" || pr.kind === "root";
      }
      if (parentOk) {
        console.info(
          "[webdav-propfind] auto-mkcol Depth:0 dir",
          requestPath,
        );
        const mk = await handleMkcol(requestPath);
        if (mk.status === 201 || mk.status === 405 || mk.status === 200) {
          resolved = await resolvePath(requestPath);
        }
      }
    }
  }

  if (resolved.kind === "missing") {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        DAV: "1, 2",
      },
    });
  }

  const responses: string[] = [];

  if (resolved.kind === "file") {
    const f = resolved.file;
    const filePath = joinFolder(f.folder, f.name);
    responses.push(
      resourceXml(filePath, false, {
        displayName: f.name,
        contentLength: f.size,
        contentType: f.mimeType || "application/octet-stream",
        lastModified: f.lastEditedTime,
        creationDate: f.createdTime,
        etag: etagFor(f),
      }),
    );
  } else {
    // 关键：必须用 requestPath，不要被 resolve 弄丢
    const folderPath =
      resolved.kind === "root"
        ? "/"
        : sanitizeFolder(resolved.path || requestPath);

    // 防御：若 requestPath 不是根却变成根，说明路径解析坏了
    if (requestPath !== "/" && folderPath === "/") {
      console.error(
        "[webdav-propfind] PATH BUG requestPath=",
        requestPath,
        "resolved=",
        resolved,
      );
    }

    const display =
      folderPath === "/"
        ? "root"
        : folderPath.split("/").filter(Boolean).pop() || "folder";
    responses.push(
      resourceXml(folderPath, true, {
        displayName: display,
        lastModified: new Date().toISOString(),
        creationDate: new Date().toISOString(),
      }),
    );

    // Depth: 0 → 仅自身；1/infinity → 一层直接子项
    if (depth !== "0") {
      const listed = await listFiles({ folder: folderPath });
      const files = (listed.files || []).filter(
        (f) => sanitizeFolder(f.folder) === folderPath,
      );
      const folders = listed.folders || [];

      console.info(
        "[webdav-propfind]",
        "request=",
        requestPath,
        "listFolder=",
        folderPath,
        `depth=${depth}`,
        `folders=${folders.length}`,
        `files=${files.length}`,
      );

      for (const name of folders) {
        if (!name || name.includes("/")) continue;
        const child = joinFolder(folderPath, name);
        responses.push(
          resourceXml(child, true, {
            displayName: name,
            lastModified: new Date().toISOString(),
          }),
        );
      }
      for (const f of files) {
        const child = joinFolder(folderPath, f.name);
        responses.push(
          resourceXml(child, false, {
            displayName: f.name,
            contentLength: f.size,
            contentType: f.mimeType || "application/octet-stream",
            lastModified: f.lastEditedTime,
            creationDate: f.createdTime,
            etag: etagFor(f),
          }),
        );
      }
    }
  }

  return xmlResponse(207, multiStatus(responses));
}

function multiStatus(responses: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="${DAV_NS}">
${responses.join("\n")}
</D:multistatus>`;
}

function xmlResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      DAV: "1, 2",
    },
  });
}

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header || size <= 0) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/i);
  if (!m) return null;
  let start = m[1] === "" ? NaN : Number(m[1]);
  let end = m[2] === "" ? NaN : Number(m[2]);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    // suffix: bytes=-500
    const suffix = end;
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start < 0 || start > end || start >= size) return null;
  }
  return { start, end };
}

export async function handleGetHead(
  path: string,
  method: "GET" | "HEAD",
  req?: NextRequest,
): Promise<Response> {
  const resolved = await resolvePath(path);
  if (resolved.kind === "root" || resolved.kind === "folder") {
    // 目录 GET → 像列表一样 405，或返回简单 HTML
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Collection — use a WebDAV client", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (resolved.kind === "missing") {
    return new Response("Not Found", { status: 404 });
  }

  const file = await getFile(resolved.file.id);
  if (!file.downloadUrl) {
    return new Response("No download URL", { status: 404 });
  }
  if (!/^https?:\/\//i.test(file.downloadUrl)) {
    return new Response("Invalid download URL", { status: 400 });
  }

  const headers = new Headers();
  headers.set("Content-Type", file.mimeType || "application/octet-stream");
  // filename* 用 UTF-8''; ASCII fallback 避免部分客户端/运行时对 header 校验失败
  const asciiName = file.name.replace(/[^\x20-\x7E]/g, "_") || "download";
  headers.set(
    "Content-Disposition",
    `attachment; filename="${asciiName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  );
  headers.set("ETag", etagFor(file));
  headers.set("Last-Modified", rfc1123(file.lastEditedTime));
  headers.set("Accept-Ranges", "bytes");
  if (file.size > 0) headers.set("Content-Length", String(file.size));

  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  // 默认 302 → Notion 临时链；WEBDAV_PROXY_DOWNLOAD=1 时本机反代（兼容不跟 302 的客户端）
  const { getRuntimeEnv } = await import("./runtime-env");
  const proxyFlag = (getRuntimeEnv("WEBDAV_PROXY_DOWNLOAD") || "").trim().toLowerCase();
  const forceProxy = proxyFlag === "1" || proxyFlag === "true" || proxyFlag === "yes";
  const rangeHeader = req?.headers.get("range") || req?.headers.get("Range");
  // Range 只能在反代模式下本机切片；302 时让客户端直连 Notion（可能不支持 Range）
  const needProxy = forceProxy || Boolean(rangeHeader);

  if (!needProxy) {
    return Response.redirect(file.downloadUrl, 302);
  }

  const range = parseRange(rangeHeader ?? null, file.size || 0);
  const fetchHeaders: Record<string, string> = {
    "User-Agent": "NotionPan-WebDAV/1.0",
  };
  if (range) {
    fetchHeaders.Range = `bytes=${range.start}-${range.end}`;
  }

  const upstream = await fetch(file.downloadUrl, {
    redirect: "follow",
    headers: fetchHeaders,
  });
  if (!upstream.ok && upstream.status !== 206) {
    // 上游不支持 Range：整文件拉取后本地切片
    if (range) {
      const full = await fetch(file.downloadUrl, {
        redirect: "follow",
        headers: { "User-Agent": "NotionPan-WebDAV/1.0" },
      });
      if (!full.ok) {
        return new Response("Upstream fetch failed", { status: 502 });
      }
      const buf = Buffer.from(await full.arrayBuffer());
      const slice = buf.subarray(range.start, range.end + 1);
      const out = new Headers(headers);
      out.set("Content-Range", `bytes ${range.start}-${range.end}/${buf.length}`);
      out.set("Content-Length", String(slice.length));
      out.set("Accept-Ranges", "bytes");
      return new Response(slice, { status: 206, headers: out });
    }
    return new Response("Upstream fetch failed", { status: 502 });
  }
  if (!upstream.body && method === "GET") {
    return new Response("Upstream fetch failed", { status: 502 });
  }

  const out = new Headers(headers);
  const ct = upstream.headers.get("content-type");
  if (ct) out.set("Content-Type", ct);
  const cr = upstream.headers.get("content-range");
  if (cr) {
    out.set("Content-Range", cr);
    out.set("Accept-Ranges", "bytes");
  } else if (range && upstream.status === 200) {
    // 上游忽略了 Range，本地再切（需读入内存）
    const buf = Buffer.from(await upstream.arrayBuffer());
    const slice = buf.subarray(range.start, range.end + 1);
    out.set("Content-Range", `bytes ${range.start}-${range.end}/${buf.length}`);
    out.set("Content-Length", String(slice.length));
    return new Response(slice, { status: 206, headers: out });
  }
  const len = upstream.headers.get("content-length");
  if (len) out.set("Content-Length", len);
  return new Response(upstream.body, {
    status: upstream.status === 206 || range ? 206 : 200,
    headers: out,
  });
}

function uploadTmpDir() {
  const dir = path.join(
    process.env.DATA_DIR || path.join(process.cwd(), "data"),
    "tmp",
    "webdav-put",
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 并发 PUT 与临时盘占用（进程内；重启清零） */
const putPathLocks = new Map<string, Promise<void>>();
let putInflight = 0;
let putTmpBytes = 0;
const MAX_PUT_INFLIGHT = 3;
/** 临时目录合计上限：约 3×Notion 单文件上限，防止无 CL 并发写盘打满 */
function maxPutTmpBytes(perFileMax: number) {
  return Math.max(perFileMax * 3, 64 * 1024 * 1024);
}

async function withPutPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = putPathLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.catch(() => undefined).then(() => gate);
  putPathLocks.set(key, chained);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    // 仅当仍是当前 gate 的后续链时清理
    if (putPathLocks.get(key) === chained) putPathLocks.delete(key);
  }
}

function safeUnlink(p: string | undefined | null) {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

/** 清理超过 1 小时的残留临时文件 */
export function cleanupStaleWebdavTmp(maxAgeMs = 60 * 60 * 1000) {
  try {
    const dir = uploadTmpDir();
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".bin")) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > maxAgeMs) fs.unlinkSync(full);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

/**
 * WebDAV PUT：请求体流式写入临时文件（边写边限大小），再 uploadFileFromPath 分片上传。
 * 峰值内存 ≈ 读缓冲；同路径串行；全局限流并发与临时盘占用。
 */
export async function handlePut(
  req: NextRequest,
  davPath: string,
  options?: {
    /** Pages 层可直接提供已落盘路径，跳过二次读 body */
    tempFilePath?: string;
    tempFileSize?: number;
  },
): Promise<Response> {
  cleanupStaleWebdavTmp();

  const p = sanitizeDavPath(davPath);
  if (p === "/") {
    return new Response("Cannot PUT root", { status: 403 });
  }

  const parent = parentFolder(p);
  const name = p.split("/").filter(Boolean).pop() || "";
  if (!name) return new Response("Bad path", { status: 400 });
  if (name === ".folder") {
    return new Response("Reserved name", { status: 403 });
  }

  let limit;
  try {
    limit = await getWorkspaceUploadLimit();
  } catch {
    limit = {
      maxFileUploadSizeInBytes: 5 * 1024 * 1024,
      workspaceName: null,
    };
  }
  const maxBytes = limit.maxFileUploadSizeInBytes;
  const tmpCap = maxPutTmpBytes(maxBytes);

  if (putInflight >= MAX_PUT_INFLIGHT) {
    return new Response("Too many concurrent uploads, try again later", {
      status: 503,
      headers: { "Retry-After": "5" },
    });
  }

  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > 0) {
    try {
      assertWithinUploadLimit(declared, limit, formatBytes);
    } catch (e) {
      return new Response(e instanceof Error ? e.message : "File too large", {
        status: 413,
      });
    }
    if (putTmpBytes + declared > tmpCap) {
      return new Response("Server upload temp space busy, try again later", {
        status: 503,
        headers: { "Retry-After": "10" },
      });
    }
  } else if (putTmpBytes >= tmpCap) {
    return new Response("Server upload temp space busy, try again later", {
      status: 503,
      headers: { "Retry-After": "10" },
    });
  }

  return withPutPathLock(p, async () => {
    putInflight += 1;
    let reserved = 0;
    let tmpPath = options?.tempFilePath;
    let total = options?.tempFileSize ?? 0;
    let ownedTmp = false;
    let countedTmp = false;

    const releaseReserve = () => {
      if (reserved > 0) {
        putTmpBytes = Math.max(0, putTmpBytes - reserved);
        reserved = 0;
      }
    };

    try {
      if (parent !== "/") {
        const parentRes = await resolvePath(parent);
        if (parentRes.kind === "missing") {
          await ensureFolderPath(parent);
        }
      }

      if (declared > 0) {
        reserved = declared;
        putTmpBytes += reserved;
        countedTmp = true;
      }

      const existing = findIndexFileByName(parent, name);
      if (existing) {
        try {
          await deleteFile(existing.id);
        } catch {
          // continue
        }
      }

      const contentType =
        req.headers.get("content-type") || "application/octet-stream";
      const mime =
        contentType.split(";")[0].trim() || "application/octet-stream";

      if (!tmpPath) {
        ownedTmp = true;
        tmpPath = path.join(
          uploadTmpDir(),
          `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.bin`,
        );
        const writer = fs.createWriteStream(tmpPath);
        const reader = req.body?.getReader();
        total = 0;

        if (reader) {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value?.byteLength) continue;
              total += value.byteLength;
              if (total > maxBytes) {
                try {
                  await reader.cancel();
                } catch {
                  // ignore
                }
                writer.destroy();
                safeUnlink(tmpPath);
                return new Response(
                  `File exceeds Notion limit (${formatBytes(maxBytes)})`,
                  { status: 413 },
                );
              }
              // 无 Content-Length 时按实际写入累计盘占用
              if (!countedTmp) {
                putTmpBytes += value.byteLength;
                reserved += value.byteLength;
                if (putTmpBytes > tmpCap) {
                  try {
                    await reader.cancel();
                  } catch {
                    // ignore
                  }
                  writer.destroy();
                  safeUnlink(tmpPath);
                  return new Response(
                    "Server upload temp space full, try again later",
                    { status: 503, headers: { "Retry-After": "10" } },
                  );
                }
              }
              if (!writer.write(Buffer.from(value))) {
                await new Promise<void>((resolve, reject) => {
                  writer.once("drain", () => resolve());
                  writer.once("error", reject);
                });
              }
            }
          } finally {
            await new Promise<void>((resolve, reject) => {
              writer.end(() => resolve());
              writer.once("error", reject);
            });
          }
        } else {
          const buf = Buffer.from(await req.arrayBuffer());
          total = buf.byteLength;
          if (total > maxBytes) {
            safeUnlink(tmpPath);
            return new Response(
              `File exceeds Notion limit (${formatBytes(maxBytes)})`,
              { status: 413 },
            );
          }
          if (!countedTmp) {
            putTmpBytes += total;
            reserved += total;
            countedTmp = true;
          }
          await fs.promises.writeFile(tmpPath, buf);
        }
      } else {
        // 外部已落盘：占用计入 reserved
        if (total > maxBytes) {
          return new Response(
            `File exceeds Notion limit (${formatBytes(maxBytes)})`,
            { status: 413 },
          );
        }
        if (!countedTmp) {
          putTmpBytes += total;
          reserved = total;
          countedTmp = true;
        }
      }

      await uploadFileFromPath({
        filePath: tmpPath!,
        size: total,
        filename: name,
        folder: parent,
        mimeType: mime,
      });

      return new Response(null, {
        status: existing ? 204 : 201,
        headers: {
          Location: hrefFor(p, false),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      const status = /超过|上限|过大|limit/i.test(msg) ? 413 : 500;
      return new Response(msg, { status });
    } finally {
      if (ownedTmp) safeUnlink(tmpPath);
      // 外部 temp 由调用方删；占用仍要释放
      releaseReserve();
      putInflight = Math.max(0, putInflight - 1);
    }
  });
}

async function ensureFolderPath(folderPath: string): Promise<void> {
  const p = sanitizeDavPath(folderPath);
  if (p === "/") return;
  const parts = p.split("/").filter(Boolean);
  let cur = "/";
  for (const part of parts) {
    const next = joinFolder(cur, part);
    // 用 marker / allFolders，避免 resolvePath 递归过重
    const marker = findFolderMarker(next);
    if (!marker) {
      const all = await listAllFolders();
      if (!all.includes(next)) {
        await createFolder(cur, part);
      }
    }
    cur = next;
  }
}

export async function handleDelete(path: string): Promise<Response> {
  const p = sanitizeFolder(path);
  if (p === "/") return new Response("Cannot delete root", { status: 403 });

  const resolved = await resolvePath(p);
  if (resolved.kind === "missing") {
    return new Response("Not Found", { status: 404 });
  }
  if (resolved.kind === "file") {
    await deleteFile(resolved.file.id);
    return new Response(null, { status: 204 });
  }
  if (resolved.kind === "root") {
    return new Response("Cannot delete root", { status: 403 });
  }

  // 文件夹：删除本路径及子树所有索引行（含 .folder 标记）
  const folderPath = resolved.path;
  const rows = listIndexRowsUnder(folderPath);
  // 先删普通文件，再删 marker（避免 list 依赖）
  const files = rows.filter((r) => r.is_folder_marker === 0);
  const markers = rows.filter((r) => r.is_folder_marker === 1);
  for (const r of [...files, ...markers]) {
    try {
      await deleteFile(r.id);
    } catch {
      // continue
    }
  }
  // 若仅有空夹（无索引行）也尝试删 marker
  if (!rows.length) {
    const marker = findFolderMarker(folderPath);
    if (marker) {
      try {
        await deleteFile(marker.id);
      } catch {
        // ignore
      }
    }
  }
  return new Response(null, { status: 204 });
}

export async function handleMkcol(path: string): Promise<Response> {
  const p = sanitizeDavPath(path);
  console.info("[webdav-mkcol]", p);

  if (p === "/") {
    // gowebdav 把 405 当 201
    return new Response(null, { status: 405, headers: { DAV: "1, 2" } });
  }

  const resolved = await resolvePath(p);
  // 已存在目录：405（gowebdav mkcol 会当成成功）
  if (resolved.kind === "folder" || resolved.kind === "root") {
    return new Response(null, {
      status: 405,
      headers: { DAV: "1, 2", Location: hrefFor(p, true) },
    });
  }
  if (resolved.kind === "file") {
    return new Response("A non-collection resource exists", {
      status: 405,
      headers: { DAV: "1, 2" },
    });
  }

  const parent = parentFolder(p);
  const name = p.split("/").filter(Boolean).pop() || "";
  if (!name) {
    return new Response("Bad name", { status: 400 });
  }

  // 父路径不存在时：WebDAV 规范可回 409；这里自动建父链（兼容 MkdirAll）
  try {
    if (parent !== "/") {
      const parentRes = await resolvePath(parent);
      if (parentRes.kind === "missing") {
        await ensureFolderPath(parent);
      } else if (parentRes.kind === "file") {
        return new Response("Parent is not a collection", {
          status: 409,
          headers: { DAV: "1, 2" },
        });
      }
    }

    await createFolder(parent, name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "MKCOL failed";
    console.error("[webdav-mkcol-error]", p, msg);
    if (/已存在|exist/i.test(msg)) {
      return new Response(null, { status: 405, headers: { DAV: "1, 2" } });
    }
    // 父不存在类错误
    if (/parent|父|not found|不存在/i.test(msg)) {
      return new Response(msg, { status: 409, headers: { DAV: "1, 2" } });
    }
    return new Response(msg, { status: 500, headers: { DAV: "1, 2" } });
  }

  return new Response(null, {
    status: 201,
    headers: {
      DAV: "1, 2",
      Location: hrefFor(p, true),
      "Content-Location": hrefFor(p, true),
    },
  });
}

function parseDestination(req: NextRequest): string | null {
  const destHeader = req.headers.get("destination") || req.headers.get("Destination");
  if (!destHeader) return null;
  let destPath = destHeader;
  try {
    if (/^https?:\/\//i.test(destHeader)) {
      const u = new URL(destHeader);
      destPath = u.pathname;
    }
  } catch {
    // relative
  }
  if (destPath.includes("/webdav")) {
    const idx = destPath.indexOf("/webdav");
    destPath = destPath.slice(idx);
  }
  return parseWebDavPath(destPath).path;
}

function overwriteAllowed(req: NextRequest): boolean {
  return (req.headers.get("overwrite") || "T").toUpperCase() !== "F";
}

async function moveOneFile(
  file: DriveFile,
  destFolder: string,
  destName: string,
  overwrite: boolean,
): Promise<void> {
  const clash = findIndexFileByName(destFolder, destName);
  if (clash && clash.id !== file.id) {
    if (!overwrite) throw new Error("Destination exists");
    await deleteFile(clash.id);
  }
  let id = file.id;
  if (destName !== file.name) {
    const renamed = await renameFile(id, destName);
    id = renamed.id;
  }
  if (destFolder !== file.folder) {
    await moveFile(id, destFolder);
  }
}

/** 整夹移动：把 src 子树映射到 dest 路径 */
async function moveFolderTree(
  src: string,
  dest: string,
  overwrite: boolean,
): Promise<void> {
  if (dest === src || dest.startsWith(`${src}/`)) {
    throw new Error("Cannot move folder into itself");
  }
  const destExists = await resolvePath(dest);
  if (destExists.kind !== "missing") {
    if (!overwrite) throw new Error("Destination exists");
    if (destExists.kind === "file") {
      await deleteFile(destExists.file.id);
    } else if (destExists.kind === "folder") {
      await handleDelete(dest);
    }
  }

  await ensureFolderPath(dest);

  const rows = listIndexRowsUnder(src);
  // 先建所有目标子目录
  const subFolders = new Set<string>();
  for (const r of rows) {
    if (r.folder === src) continue;
    if (r.folder.startsWith(`${src}/`)) {
      const rel = r.folder.slice(src.length);
      subFolders.add(sanitizeFolder(`${dest}${rel}`));
    }
  }
  const sorted = Array.from(subFolders).sort(
    (a, b) => a.split("/").length - b.split("/").length,
  );
  for (const fp of sorted) {
    await ensureFolderPath(fp);
  }

  // 移动文件（非 marker）
  for (const r of rows) {
    if (r.is_folder_marker === 1) continue;
    const relFolder =
      r.folder === src ? dest : sanitizeFolder(dest + r.folder.slice(src.length));
    await moveOneFile(rowToDriveLike(r), relFolder, r.name, overwrite);
  }

  // 删源树 marker
  for (const r of rows) {
    if (r.is_folder_marker !== 1) continue;
    try {
      await deleteFile(r.id);
    } catch {
      // ignore
    }
  }
  const srcMarker = findFolderMarker(src);
  if (srcMarker) {
    try {
      await deleteFile(srcMarker.id);
    } catch {
      // ignore
    }
  }
}

function rowToDriveLike(r: {
  id: string;
  name: string;
  folder: string;
  size: number;
  mime_type: string;
  kind: string;
  created_time: string;
  last_edited_time: string;
}): DriveFile {
  return {
    id: r.id,
    name: r.name,
    folder: r.folder,
    size: r.size,
    mimeType: r.mime_type,
    kind: (r.kind as DriveFile["kind"]) || "file",
    createdTime: r.created_time,
    lastEditedTime: r.last_edited_time,
  };
}

export async function handleMove(
  req: NextRequest,
  path: string,
): Promise<Response> {
  const dest = parseDestination(req);
  if (!dest) {
    return new Response("Missing Destination", { status: 400 });
  }
  const src = sanitizeFolder(path);
  if (src === "/" || dest === "/") {
    return new Response("Invalid move", { status: 403 });
  }
  if (src === dest) {
    return new Response(null, { status: 204 });
  }

  const resolved = await resolvePath(src);
  if (resolved.kind === "missing") {
    return new Response("Not Found", { status: 404 });
  }
  if (resolved.kind === "root") {
    return new Response("Invalid move", { status: 403 });
  }

  const overwrite = overwriteAllowed(req);
  const destParent = parentFolder(dest);
  const destName = dest.split("/").filter(Boolean).pop() || "";
  if (!destName) return new Response("Bad destination", { status: 400 });

  if (destParent !== "/") {
    const pr = await resolvePath(destParent);
    if (pr.kind === "missing") await ensureFolderPath(destParent);
  }

  try {
    if (resolved.kind === "folder") {
      await moveFolderTree(src, dest, overwrite);
      return new Response(null, {
        status: 201,
        headers: { Location: hrefFor(dest, true) },
      });
    }

    await moveOneFile(resolved.file, destParent, destName, overwrite);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "MOVE failed";
    if (/exists/i.test(msg)) {
      return new Response(msg, { status: 412 });
    }
    return new Response(msg, { status: 500 });
  }

  return new Response(null, {
    status: 201,
    headers: { Location: hrefFor(dest, false) },
  });
}

/** 复制文件：重新下载再上传（Notion 无服务端 copy 附件） */
async function copyOneFile(
  file: DriveFile,
  destFolder: string,
  destName: string,
  overwrite: boolean,
): Promise<void> {
  const clash = findIndexFileByName(destFolder, destName);
  if (clash) {
    if (!overwrite) throw new Error("Destination exists");
    await deleteFile(clash.id);
  }

  const fresh = await getFile(file.id);
  if (!fresh.downloadUrl) throw new Error("No download URL for copy source");

  const limit = await getWorkspaceUploadLimit();
  if (fresh.size > 0) {
    assertWithinUploadLimit(fresh.size, limit, formatBytes);
  }

  const upstream = await fetch(fresh.downloadUrl, {
    redirect: "follow",
    headers: { "User-Agent": "NotionPan-WebDAV/1.0" },
  });
  if (!upstream.ok) throw new Error(`Copy source fetch failed (${upstream.status})`);

  const buf = new Uint8Array(await upstream.arrayBuffer());
  if (buf.byteLength > limit.maxFileUploadSizeInBytes) {
    throw new Error(
      `File exceeds Notion limit (${formatBytes(limit.maxFileUploadSizeInBytes)})`,
    );
  }
  const mime =
    fresh.mimeType ||
    upstream.headers.get("content-type") ||
    "application/octet-stream";
  const blob = new Blob([buf], { type: mime.split(";")[0].trim() });
  await uploadFile({
    file: blob,
    filename: destName,
    folder: destFolder,
  });
}

async function copyFolderTree(
  src: string,
  dest: string,
  overwrite: boolean,
): Promise<void> {
  if (dest === src || dest.startsWith(`${src}/`)) {
    throw new Error("Cannot copy folder into itself");
  }
  const destExists = await resolvePath(dest);
  if (destExists.kind !== "missing") {
    if (!overwrite) throw new Error("Destination exists");
    if (destExists.kind === "file") {
      await deleteFile(destExists.file.id);
    } else if (destExists.kind === "folder") {
      // 合并复制：不整树删除，仅覆盖同名文件
    }
  }

  await ensureFolderPath(dest);
  const rows = listIndexRowsUnder(src);

  const subFolders = new Set<string>();
  for (const r of rows) {
    if (r.folder === src) continue;
    if (r.folder.startsWith(`${src}/`)) {
      subFolders.add(sanitizeFolder(`${dest}${r.folder.slice(src.length)}`));
    }
  }
  for (const fp of Array.from(subFolders).sort(
    (a, b) => a.split("/").length - b.split("/").length,
  )) {
    await ensureFolderPath(fp);
  }

  for (const r of rows) {
    if (r.is_folder_marker === 1) continue;
    const relFolder =
      r.folder === src ? dest : sanitizeFolder(dest + r.folder.slice(src.length));
    await copyOneFile(rowToDriveLike(r), relFolder, r.name, overwrite);
  }
}

export async function handleCopy(
  req: NextRequest,
  path: string,
): Promise<Response> {
  const dest = parseDestination(req);
  if (!dest) {
    return new Response("Missing Destination", { status: 400 });
  }
  const src = sanitizeFolder(path);
  if (src === "/" || dest === "/") {
    return new Response("Invalid copy", { status: 403 });
  }
  if (src === dest) {
    return new Response(null, { status: 204 });
  }

  const resolved = await resolvePath(src);
  if (resolved.kind === "missing") {
    return new Response("Not Found", { status: 404 });
  }
  if (resolved.kind === "root") {
    return new Response("Invalid copy", { status: 403 });
  }

  const overwrite = overwriteAllowed(req);
  const destParent = parentFolder(dest);
  const destName = dest.split("/").filter(Boolean).pop() || "";
  if (!destName) return new Response("Bad destination", { status: 400 });

  if (destParent !== "/") {
    const pr = await resolvePath(destParent);
    if (pr.kind === "missing") await ensureFolderPath(destParent);
  }

  try {
    if (resolved.kind === "folder") {
      await copyFolderTree(src, dest, overwrite);
      return new Response(null, {
        status: 201,
        headers: { Location: hrefFor(dest, true) },
      });
    }
    await copyOneFile(resolved.file, destParent, destName, overwrite);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "COPY failed";
    if (/exists/i.test(msg)) {
      return new Response(msg, { status: 412 });
    }
    if (/超过|上限|limit/i.test(msg)) {
      return new Response(msg, { status: 413 });
    }
    return new Response(msg, { status: 500 });
  }

  return new Response(null, {
    status: 201,
    headers: { Location: hrefFor(dest, false) },
  });
}

export function methodFromRequest(req: NextRequest | Request): string {
  const headers = req.headers;
  const override =
    headers.get("x-http-method-override") ||
    headers.get("X-HTTP-Method-Override") ||
    "";
  if (override) return override.toUpperCase();
  try {
    if ("nextUrl" in req && req.nextUrl) {
      const m = req.nextUrl.searchParams.get("_method");
      if (m) return m.toUpperCase();
    } else {
      const u = new URL(req.url);
      const m = u.searchParams.get("_method");
      if (m) return m.toUpperCase();
    }
  } catch {
    // ignore
  }
  return (req.method || "GET").toUpperCase();
}
