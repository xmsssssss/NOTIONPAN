import fs from "fs";
import path from "path";
import type { DriveFile, FileKind } from "./types";
import { bareNotionId, normalizeNotionId, sameNotionId } from "./utils";

/**
 * 本地文件索引
 * - 优先：Node 内置 node:sqlite（Node ≥ 22.5）
 * - 回退：data/index.json（兼容旧 Node）
 */

export type IndexRow = {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  kind: string;
  folder: string;
  created_time: string;
  last_edited_time: string;
  url: string | null;
  is_folder_marker: number;
};

type IndexStore = {
  version: 1;
  meta: Record<string, string>;
  files: IndexRow[];
};

type SqliteDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
  close: () => void;
};

export type IndexBackend = "sqlite" | "json";

const EMPTY: IndexStore = { version: 1, meta: {}, files: [] };

let backend: IndexBackend | null = null;
let sqliteDb: SqliteDb | null = null;
let jsonCache: IndexStore | null = null;

/** 全量同步期间的并发写入缓冲，replace 后合并，避免冲掉上传/webhook */
let fullSyncDepth = 0;
const pendingUpserts = new Map<string, IndexRow>();
const pendingDeletes = new Set<string>();

export function beginIndexFullSync() {
  fullSyncDepth += 1;
  if (fullSyncDepth === 1) {
    pendingUpserts.clear();
    pendingDeletes.clear();
  }
}

function noteIndexUpsert(row: IndexRow) {
  if (fullSyncDepth <= 0) return;
  pendingDeletes.delete(row.id);
  pendingUpserts.set(row.id, row);
}

function noteIndexDelete(id: string) {
  if (fullSyncDepth <= 0) return;
  pendingUpserts.delete(id);
  pendingDeletes.add(id);
}

/** 将并发 upsert/delete 合并进快照后结束一层 full sync */
export function mergeConcurrentIndexWrites(snapshot: IndexRow[]): IndexRow[] {
  const map = new Map<string, IndexRow>();
  for (const row of snapshot) map.set(row.id, row);
  for (const id of pendingDeletes) map.delete(id);
  for (const [id, row] of pendingUpserts) map.set(id, row);

  fullSyncDepth = Math.max(0, fullSyncDepth - 1);
  if (fullSyncDepth === 0) {
    pendingUpserts.clear();
    pendingDeletes.clear();
  }
  return [...map.values()];
}

export function abortIndexFullSync() {
  fullSyncDepth = Math.max(0, fullSyncDepth - 1);
  if (fullSyncDepth === 0) {
    pendingUpserts.clear();
    pendingDeletes.clear();
  }
}

function dataDir() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sqlitePath() {
  return path.join(dataDir(), "index.sqlite");
}

function jsonPath() {
  return path.join(dataDir(), "index.json");
}

function tryOpenSqlite(): SqliteDb | null {
  try {
    // 动态加载，避免打包期静态解析失败
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteDb;
    };
    if (!mod?.DatabaseSync) return null;
    const db = new mod.DatabaseSync(sqlitePath());
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        mime_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        folder TEXT NOT NULL,
        created_time TEXT NOT NULL,
        last_edited_time TEXT NOT NULL,
        url TEXT,
        is_folder_marker INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder);
      CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
      CREATE INDEX IF NOT EXISTS idx_files_marker ON files(is_folder_marker);
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    return db;
  } catch {
    return null;
  }
}

function loadJsonStore(): IndexStore {
  if (jsonCache) return jsonCache;
  const p = jsonPath();
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<IndexStore>;
      jsonCache = {
        version: 1,
        meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
        files: Array.isArray(raw.files) ? raw.files : [],
      };
      return jsonCache;
    }
  } catch {
    // corrupt
  }
  jsonCache = { ...EMPTY, meta: {}, files: [] };
  return jsonCache;
}

function saveJsonStore(store: IndexStore) {
  const p = jsonPath();
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, p);
  jsonCache = store;
}

function ensureBackend(): IndexBackend {
  if (backend) return backend;
  const db = tryOpenSqlite();
  if (db) {
    sqliteDb = db;
    backend = "sqlite";
    // 若仅有旧 JSON 索引且 sqlite 为空，可一次性迁移
    tryMigrateJsonToSqlite();
    return backend;
  }
  backend = "json";
  return backend;
}

function tryMigrateJsonToSqlite() {
  if (!sqliteDb) return;
  const count = sqliteDb.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number };
  if (count?.c > 0) return;
  if (!fs.existsSync(jsonPath())) return;
  try {
    const store = loadJsonStore();
    if (!store.files.length && !Object.keys(store.meta).length) return;
    replaceAllIndexSqlite(store.files);
    for (const [k, v] of Object.entries(store.meta)) {
      setMetaSqlite(k, v);
    }
  } catch {
    // ignore migrate errors
  }
}

export function getIndexBackend(): IndexBackend {
  return ensureBackend();
}

export function closeDb() {
  if (sqliteDb) {
    try {
      sqliteDb.close();
    } catch {
      // ignore
    }
  }
  sqliteDb = null;
  jsonCache = null;
  backend = null;
}

// ---------- meta ----------

function setMetaSqlite(key: string, value: string) {
  sqliteDb!
    .prepare(
      `INSERT INTO meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getMeta(key: string): string | null {
  if (ensureBackend() === "sqlite") {
    const row = sqliteDb!.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }
  return loadJsonStore().meta[key] ?? null;
}

export function setMeta(key: string, value: string) {
  if (ensureBackend() === "sqlite") {
    setMetaSqlite(key, value);
    return;
  }
  const store = loadJsonStore();
  store.meta[key] = value;
  saveJsonStore(store);
}

// ---------- row helpers ----------

export function rowToDriveFile(row: IndexRow): DriveFile {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    mimeType: row.mime_type,
    kind: row.kind as FileKind,
    folder: row.folder,
    createdTime: row.created_time,
    lastEditedTime: row.last_edited_time,
    url: row.url || undefined,
  };
}

export function driveFileToRow(file: DriveFile, isFolderMarker = false): IndexRow {
  return {
    id: normalizeNotionId(file.id),
    name: file.name,
    size: file.size,
    mime_type: file.mimeType,
    kind: file.kind,
    folder: file.folder,
    created_time: file.createdTime,
    last_edited_time: file.lastEditedTime,
    url: file.url || null,
    is_folder_marker: isFolderMarker ? 1 : 0,
  };
}

// ---------- write ----------

function replaceAllIndexSqlite(rows: IndexRow[]) {
  const database = sqliteDb!;
  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM files").run();
    const stmt = database.prepare(`
      INSERT INTO files (
        id, name, size, mime_type, kind, folder,
        created_time, last_edited_time, url, is_folder_marker
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of rows) {
      stmt.run(
        r.id,
        r.name,
        r.size,
        r.mime_type,
        r.kind,
        r.folder,
        r.created_time,
        r.last_edited_time,
        r.url,
        r.is_folder_marker,
      );
    }
    database.exec("COMMIT");
  } catch (e) {
    database.exec("ROLLBACK");
    throw e;
  }
}

export function replaceAllIndex(rows: IndexRow[]) {
  if (ensureBackend() === "sqlite") {
    replaceAllIndexSqlite(rows);
    return;
  }
  const store = loadJsonStore();
  store.files = rows.slice();
  saveJsonStore(store);
}

export function upsertIndexRow(row: IndexRow) {
  const normalized: IndexRow = { ...row, id: normalizeNotionId(row.id) };
  noteIndexUpsert(normalized);
  if (ensureBackend() === "sqlite") {
    const bare = bareNotionId(normalized.id);
    // 清理历史 bare/异形 id，避免双行
    if (bare) {
      sqliteDb!
        .prepare(
          `DELETE FROM files WHERE id != ? AND lower(replace(id, '-', '')) = ?`,
        )
        .run(normalized.id, bare);
    }
    sqliteDb!
      .prepare(
        `
      INSERT INTO files (
        id, name, size, mime_type, kind, folder,
        created_time, last_edited_time, url, is_folder_marker
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        size = excluded.size,
        mime_type = excluded.mime_type,
        kind = excluded.kind,
        folder = excluded.folder,
        created_time = excluded.created_time,
        last_edited_time = excluded.last_edited_time,
        url = excluded.url,
        is_folder_marker = excluded.is_folder_marker
    `,
      )
      .run(
        normalized.id,
        normalized.name,
        normalized.size,
        normalized.mime_type,
        normalized.kind,
        normalized.folder,
        normalized.created_time,
        normalized.last_edited_time,
        normalized.url,
        normalized.is_folder_marker,
      );
    return;
  }
  const store = loadJsonStore();
  const bare = bareNotionId(normalized.id);
  store.files = store.files.filter(
    (f) => bareNotionId(f.id) !== bare || f.id === normalized.id,
  );
  const i = store.files.findIndex((f) => f.id === normalized.id);
  if (i >= 0) store.files[i] = normalized;
  else store.files.push(normalized);
  saveJsonStore(store);
}

export function deleteIndexRow(id: string) {
  const bare = bareNotionId(id);
  const canonical = normalizeNotionId(id);
  noteIndexDelete(canonical);
  if (bare) noteIndexDelete(bare);
  if (ensureBackend() === "sqlite") {
    if (bare) {
      sqliteDb!
        .prepare(`DELETE FROM files WHERE lower(replace(id, '-', '')) = ?`)
        .run(bare);
    } else {
      sqliteDb!.prepare("DELETE FROM files WHERE id = ?").run(id);
    }
    return;
  }
  const store = loadJsonStore();
  store.files = bare
    ? store.files.filter((f) => bareNotionId(f.id) !== bare)
    : store.files.filter((f) => f.id !== id);
  saveJsonStore(store);
}

// ---------- read ----------

function sortByCreatedDesc(a: IndexRow, b: IndexRow) {
  return (b.created_time || "").localeCompare(a.created_time || "");
}

/** 同目录下是否已有同名（可选再比大小）的文件 */
export function findIndexFileByName(
  folder: string,
  name: string,
  size?: number,
): DriveFile | null {
  const f = folder;
  const n = name;
  if (ensureBackend() === "sqlite") {
    if (typeof size === "number" && Number.isFinite(size)) {
      const row = sqliteDb!
        .prepare(
          `
          SELECT * FROM files
          WHERE folder = ? AND is_folder_marker = 0 AND name = ? AND size = ?
          LIMIT 1
        `,
        )
        .get(f, n, size) as IndexRow | undefined;
      return row ? rowToDriveFile(row) : null;
    }
    const row = sqliteDb!
      .prepare(
        `
        SELECT * FROM files
        WHERE folder = ? AND is_folder_marker = 0 AND name = ?
        LIMIT 1
      `,
      )
      .get(f, n) as IndexRow | undefined;
    return row ? rowToDriveFile(row) : null;
  }

  const store = loadJsonStore();
  const hit = store.files.find((r) => {
    if (r.is_folder_marker !== 0) return false;
    if (r.folder !== f || r.name !== n) return false;
    if (typeof size === "number" && Number.isFinite(size) && r.size !== size) return false;
    return true;
  });
  return hit ? rowToDriveFile(hit) : null;
}

export function listIndexFiles(folder: string, query?: string): DriveFile[] {
  if (ensureBackend() === "sqlite") {
    const f = folder;
    const q = query?.trim();
    let rows: IndexRow[];
    if (q) {
      if (f === "/") {
        rows = sqliteDb!
          .prepare(
            `
          SELECT * FROM files
          WHERE is_folder_marker = 0 AND name LIKE ?
          ORDER BY created_time DESC
        `,
          )
          .all(`%${q}%`) as IndexRow[];
      } else {
        rows = sqliteDb!
          .prepare(
            `
          SELECT * FROM files
          WHERE is_folder_marker = 0
            AND name LIKE ?
            AND (folder = ? OR folder LIKE ?)
          ORDER BY created_time DESC
        `,
          )
          .all(`%${q}%`, f, `${f}/%`) as IndexRow[];
      }
    } else {
      rows = sqliteDb!
        .prepare(
          `
        SELECT * FROM files
        WHERE folder = ? AND is_folder_marker = 0
        ORDER BY created_time DESC
      `,
        )
        .all(f) as IndexRow[];
    }
    return rows.map(rowToDriveFile);
  }

  const store = loadJsonStore();
  const f = folder;
  const q = query?.trim().toLowerCase();
  let rows = store.files.filter((r) => r.is_folder_marker === 0);
  if (q) {
    rows = rows.filter((r) => {
      if (!r.name.toLowerCase().includes(q)) return false;
      if (f === "/") return true;
      return r.folder === f || r.folder.startsWith(`${f}/`);
    });
  } else {
    rows = rows.filter((r) => r.folder === f);
  }
  return rows.sort(sortByCreatedDesc).map(rowToDriveFile);
}

export function listIndexSubfolders(folder: string, query?: string): string[] {
  const set = new Set<string>();
  const prefix = folder === "/" ? "/" : `${folder}/`;
  const q = query?.trim().toLowerCase();

  let folders: string[] = [];
  if (ensureBackend() === "sqlite") {
    folders = (
      sqliteDb!.prepare(`SELECT DISTINCT folder FROM files`).all() as Array<{ folder: string }>
    ).map((r) => r.folder || "/");
  } else {
    folders = loadJsonStore().files.map((r) => r.folder || "/");
  }

  for (const f of folders) {
    let child: string | null = null;
    if (folder === "/") {
      if (f !== "/" && f.startsWith("/")) {
        child = f.split("/").filter(Boolean)[0] || null;
      }
    } else if (f !== folder && f.startsWith(prefix)) {
      child = f.slice(prefix.length).split("/").filter(Boolean)[0] || null;
    }
    if (!child) continue;
    if (q && !child.toLowerCase().includes(q)) continue;
    set.add(child);
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function listIndexAllFolders(): string[] {
  const set = new Set<string>(["/"]);
  let folders: string[] = [];
  if (ensureBackend() === "sqlite") {
    folders = (
      sqliteDb!.prepare(`SELECT DISTINCT folder FROM files`).all() as Array<{ folder: string }>
    ).map((r) => r.folder || "/");
  } else {
    folders = loadJsonStore().files.map((r) => r.folder || "/");
  }

  for (const f of folders) {
    set.add(f);
    if (f !== "/") {
      const parts = f.split("/").filter(Boolean);
      let cur = "";
      for (const p of parts) {
        cur += `/${p}`;
        set.add(cur);
      }
    }
  }

  return Array.from(set).sort((a, b) => {
    if (a === "/") return -1;
    if (b === "/") return 1;
    return a.localeCompare(b, "zh-CN");
  });
}

export function indexCount(): number {
  if (ensureBackend() === "sqlite") {
    const row = sqliteDb!.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number };
    return row.c;
  }
  return loadJsonStore().files.length;
}

export function exportIndexJson(): string {
  if (ensureBackend() === "sqlite") {
    const files = sqliteDb!.prepare("SELECT * FROM files").all() as IndexRow[];
    const metaRows = sqliteDb!.prepare("SELECT key, value FROM meta").all() as Array<{
      key: string;
      value: string;
    }>;
    const meta: Record<string, string> = {};
    for (const m of metaRows) meta[m.key] = m.value;
    return JSON.stringify({ version: 1, meta, files });
  }
  return JSON.stringify(loadJsonStore());
}

export function importIndexJson(text: string) {
  const raw = JSON.parse(text) as Partial<IndexStore>;
  const files = Array.isArray(raw.files) ? raw.files : [];
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {};

  closeDb();
  if (ensureBackend() === "sqlite") {
    replaceAllIndexSqlite(files);
    for (const [k, v] of Object.entries(meta)) {
      setMetaSqlite(k, v);
    }
    return;
  }
  saveJsonStore({ version: 1, meta, files });
}
