import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type { DriveFile, FileKind } from "./types";

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

let db: DatabaseSync | null = null;

function dbPath() {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "index.sqlite");
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const database = new DatabaseSync(dbPath());
  database.exec(`
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
  db = database;
  return database;
}

export function getMeta(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

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

export function driveFileToRow(
  file: DriveFile,
  isFolderMarker = false,
): IndexRow {
  return {
    id: file.id,
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

export function replaceAllIndex(rows: IndexRow[]) {
  const database = getDb();
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

export function upsertIndexRow(row: IndexRow) {
  getDb()
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
      row.id,
      row.name,
      row.size,
      row.mime_type,
      row.kind,
      row.folder,
      row.created_time,
      row.last_edited_time,
      row.url,
      row.is_folder_marker,
    );
}

export function deleteIndexRow(id: string) {
  getDb().prepare("DELETE FROM files WHERE id = ?").run(id);
}

export function listIndexFiles(folder: string, query?: string): DriveFile[] {
  const f = folder;
  const q = query?.trim();
  let rows: IndexRow[];

  if (q) {
    // 搜索：当前目录及所有子目录中文件名匹配
    if (f === "/") {
      rows = getDb()
        .prepare(
          `
        SELECT * FROM files
        WHERE is_folder_marker = 0 AND name LIKE ?
        ORDER BY created_time DESC
      `,
        )
        .all(`%${q}%`) as IndexRow[];
    } else {
      rows = getDb()
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
    rows = getDb()
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

export function listIndexSubfolders(folder: string, query?: string): string[] {
  const set = new Set<string>();
  const prefix = folder === "/" ? "/" : `${folder}/`;
  const q = query?.trim().toLowerCase();
  const rows = getDb()
    .prepare(`SELECT DISTINCT folder FROM files`)
    .all() as Array<{ folder: string }>;

  for (const row of rows) {
    const f = row.folder || "/";
    let child: string | null = null;

    if (folder === "/") {
      if (f !== "/" && f.startsWith("/")) {
        child = f.split("/").filter(Boolean)[0] || null;
      }
    } else if (f !== folder && f.startsWith(prefix)) {
      child = f.slice(prefix.length).split("/").filter(Boolean)[0] || null;
    }

    if (!child) continue;
    // 搜索时只保留名称匹配的文件夹
    if (q && !child.toLowerCase().includes(q)) continue;
    set.add(child);
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function listIndexAllFolders(): string[] {
  const set = new Set<string>(["/"]);
  const rows = getDb()
    .prepare(`SELECT DISTINCT folder FROM files`)
    .all() as Array<{ folder: string }>;

  for (const row of rows) {
    const f = row.folder || "/";
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
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number };
  return row.c;
}
