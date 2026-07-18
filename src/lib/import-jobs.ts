import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { DriveFile, FileKind } from "./types";

export type ImportJobStatus =
  | "pending"
  | "uploaded"
  | "done"
  | "error"
  | "skipped";

export type ImportJob = {
  id: string;
  fileUploadId: string;
  url: string;
  displayName: string;
  uploadName: string;
  folder: string;
  kind: FileKind;
  rawMime: string;
  uploadMime: string;
  status: ImportJobStatus;
  error?: string;
  file?: DriveFile;
  contentLength?: number;
  createdAt: string;
  updatedAt: string;
};

type JobStore = {
  version: 1;
  jobs: ImportJob[];
};

const EMPTY: JobStore = { version: 1, jobs: [] };
const MAX_JOBS = 80;
const JOB_TTL_MS = 48 * 60 * 60 * 1000;

let cache: JobStore | null = null;

function dataDir() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function storePath() {
  return path.join(dataDir(), "import-jobs.json");
}

function load(): JobStore {
  if (cache) return cache;
  const p = storePath();
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<JobStore>;
      cache = {
        version: 1,
        jobs: Array.isArray(raw.jobs) ? (raw.jobs as ImportJob[]) : [],
      };
      return cache;
    }
  } catch {
    // ignore
  }
  cache = { ...EMPTY, jobs: [] };
  return cache;
}

function save(store: JobStore) {
  const p = storePath();
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, p);
  cache = store;
}

function prune(store: JobStore) {
  const now = Date.now();
  store.jobs = store.jobs
    .filter((j) => now - Date.parse(j.createdAt || "") < JOB_TTL_MS)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_JOBS);
}

export function createImportJob(
  input: Omit<ImportJob, "id" | "status" | "createdAt" | "updatedAt"> & {
    status?: ImportJobStatus;
  },
): ImportJob {
  const now = new Date().toISOString();
  const job: ImportJob = {
    id: crypto.randomBytes(12).toString("hex"),
    fileUploadId: input.fileUploadId,
    url: input.url,
    displayName: input.displayName,
    uploadName: input.uploadName,
    folder: input.folder,
    kind: input.kind,
    rawMime: input.rawMime,
    uploadMime: input.uploadMime,
    status: input.status || "pending",
    error: input.error,
    file: input.file,
    contentLength: input.contentLength,
    createdAt: now,
    updatedAt: now,
  };
  const store = load();
  store.jobs.unshift(job);
  prune(store);
  save(store);
  return job;
}

export function getImportJob(id: string): ImportJob | null {
  return load().jobs.find((j) => j.id === id) || null;
}

export function getImportJobByUploadId(fileUploadId: string): ImportJob | null {
  const id = fileUploadId.replace(/-/g, "").toLowerCase();
  return (
    load().jobs.find(
      (j) => j.fileUploadId.replace(/-/g, "").toLowerCase() === id,
    ) || null
  );
}

export function updateImportJob(
  id: string,
  patch: Partial<ImportJob>,
): ImportJob | null {
  const store = load();
  const idx = store.jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  const next: ImportJob = {
    ...store.jobs[idx],
    ...patch,
    id: store.jobs[idx].id,
    updatedAt: new Date().toISOString(),
  };
  store.jobs[idx] = next;
  save(store);
  return next;
}

export function publicImportJob(job: ImportJob) {
  return {
    id: job.id,
    status: job.status,
    name: job.displayName,
    folder: job.folder,
    url: job.url,
    error: job.error,
    file: job.file,
    contentLength: job.contentLength,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
