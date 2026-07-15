import crypto from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

export type ShareRecord = {
  token: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  kind: string;
  size: number;
  passwordHash: string | null;
  expiresAt: string | null;
  allowDownload: boolean;
  allowPreview: boolean;
  createdAt: string;
  createdBy: string;
  revoked: boolean;
  accessCount: number;
  lastAccessAt: string | null;
};

type ShareStore = {
  version: 1;
  shares: ShareRecord[];
};

const EMPTY: ShareStore = { version: 1, shares: [] };
let cache: ShareStore | null = null;

function dataDir() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function storePath() {
  return path.join(dataDir(), "shares.json");
}

function load(): ShareStore {
  if (cache) return cache;
  const p = storePath();
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ShareStore>;
      cache = {
        version: 1,
        shares: Array.isArray(raw.shares) ? raw.shares : [],
      };
      return cache;
    }
  } catch {
    // ignore
  }
  cache = { ...EMPTY, shares: [] };
  return cache;
}

function save(store: ShareStore) {
  const p = storePath();
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, p);
  cache = store;
}

function newToken() {
  return crypto.randomBytes(18).toString("base64url");
}

export function listShares(fileId?: string): ShareRecord[] {
  const store = load();
  return store.shares
    .filter((s) => !s.revoked && (!fileId || s.fileId === fileId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getShare(token: string): ShareRecord | null {
  const store = load();
  return store.shares.find((s) => s.token === token) || null;
}

export function isShareActive(share: ShareRecord): { ok: boolean; reason?: string } {
  if (share.revoked) return { ok: false, reason: "分享已撤销" };
  if (share.expiresAt) {
    const t = Date.parse(share.expiresAt);
    if (Number.isFinite(t) && Date.now() > t) {
      return { ok: false, reason: "分享已过期" };
    }
  }
  return { ok: true };
}

export async function createShare(input: {
  fileId: string;
  fileName: string;
  mimeType: string;
  kind: string;
  size: number;
  password?: string;
  expiresInHours?: number | null;
  allowDownload?: boolean;
  allowPreview?: boolean;
  createdBy: string;
}): Promise<ShareRecord> {
  const store = load();
  const token = newToken();
  let passwordHash: string | null = null;
  if (input.password && input.password.trim()) {
    passwordHash = await bcrypt.hash(input.password.trim(), 10);
  }

  let expiresAt: string | null = null;
  if (input.expiresInHours && input.expiresInHours > 0) {
    expiresAt = new Date(Date.now() + input.expiresInHours * 3600 * 1000).toISOString();
  }

  const rec: ShareRecord = {
    token,
    fileId: input.fileId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    kind: input.kind,
    size: input.size,
    passwordHash,
    expiresAt,
    allowDownload: input.allowDownload !== false,
    allowPreview: input.allowPreview !== false,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    revoked: false,
    accessCount: 0,
    lastAccessAt: null,
  };

  store.shares.unshift(rec);
  save(store);
  return rec;
}

export function revokeShare(token: string): boolean {
  const store = load();
  const rec = store.shares.find((s) => s.token === token);
  if (!rec) return false;
  rec.revoked = true;
  save(store);
  return true;
}

export function touchShare(token: string) {
  const store = load();
  const rec = store.shares.find((s) => s.token === token);
  if (!rec) return;
  rec.accessCount += 1;
  rec.lastAccessAt = new Date().toISOString();
  save(store);
}

export async function verifySharePassword(share: ShareRecord, password: string): Promise<boolean> {
  if (!share.passwordHash) return true;
  return bcrypt.compare(password, share.passwordHash);
}

export function publicShareView(share: ShareRecord) {
  return {
    token: share.token,
    fileName: share.fileName,
    mimeType: share.mimeType,
    kind: share.kind,
    size: share.size,
    hasPassword: Boolean(share.passwordHash),
    expiresAt: share.expiresAt,
    allowDownload: share.allowDownload,
    allowPreview: share.allowPreview,
    createdAt: share.createdAt,
    accessCount: share.accessCount,
  };
}
