import "server-only";

import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { Worker } from "worker_threads";
import * as Comlink from "comlink";
import {
  type ArchiveEntry,
  isBrowsableArchive,
  isZipArchive,
  listZipEntries,
} from "@/lib/archive";

type ArchiveHandle = {
  getFilesArray: () => Promise<
    Array<{ file?: { name?: string; size?: number } | string; path?: string }>
  >;
  close?: () => Promise<void>;
};

type LibArchiveModule = {
  Archive: {
    init: (options: {
      getWorker?: () => Worker;
      createClient?: (worker: Worker) => unknown;
    }) => unknown;
    open: (file: File) => Promise<ArchiveHandle>;
  };
};

const require = createRequire(path.join(process.cwd(), "package.json"));

let libArchiveReady: Promise<LibArchiveModule> | null = null;

function libarchiveDistDir(): string {
  const pkgJson = require.resolve("libarchive.js/package.json");
  return path.join(path.dirname(pkgJson), "dist");
}

async function loadLibArchive(): Promise<LibArchiveModule> {
  if (!libArchiveReady) {
    libArchiveReady = (async () => {
      const dist = libarchiveDistDir();
      const entry = pathToFileURL(path.join(dist, "libarchive-node.mjs")).href;
      const mod = (await import(/* webpackIgnore: true */ entry)) as LibArchiveModule;
      const workerPath = path.join(dist, "worker-bundle-node.mjs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeEndpoint = require("comlink/dist/esm/node-adapter.js").default as (
        w: Worker,
      ) => unknown;

      mod.Archive.init({
        getWorker: () => new Worker(workerPath),
        createClient: (worker) => Comlink.wrap(nodeEndpoint(worker) as never),
      });
      return mod;
    })();
  }
  return libArchiveReady;
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

async function listLibArchiveEntries(
  data: Uint8Array,
  fileName: string,
): Promise<ArchiveEntry[]> {
  const { Archive } = await loadLibArchive();
  const ab = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const file = new File([ab], fileName || "archive.bin", {
    type: "application/octet-stream",
  });

  const archive = await Archive.open(file);
  try {
    const arr = await archive.getFilesArray();
    const entries: ArchiveEntry[] = [];
    for (const item of arr || []) {
      const f = item?.file as { name?: string; size?: number } | string | undefined;
      const rawPath =
        (typeof item?.path === "string" && item.path) ||
        (typeof f === "object" && f && typeof f.name === "string" ? f.name : "") ||
        (typeof f === "string" ? f : "");
      if (!rawPath) continue;
      const isDir = rawPath.endsWith("/");
      const name = rawPath.replace(/\/+$/, "");
      if (!name) continue;
      const size =
        typeof f === "object" && f && typeof f.size === "number" ? f.size : 0;
      entries.push({ name, size, isDir });
    }
    return sortEntries(entries);
  } finally {
    try {
      await archive.close?.();
    } catch {
      /* ignore */
    }
  }
}

/** 仅服务端：按格式列压缩包目录 */
export async function listArchiveEntries(
  data: Uint8Array,
  fileName: string,
  mimeType?: string,
): Promise<ArchiveEntry[]> {
  if (isZipArchive(fileName, mimeType)) {
    try {
      return listZipEntries(data);
    } catch {
      /* fall through */
    }
  }
  if (isBrowsableArchive(fileName, mimeType)) {
    return await listLibArchiveEntries(data, fileName);
  }
  throw new Error("不支持的压缩格式");
}
