import fs from "fs";
import path from "path";
import { readAppConfig, writeAppConfig, type AppConfig } from "./app-config";
import { readEnvConfig, writeEnvConfig, softReloadEnv } from "./runtime-env";
import { getMeta, indexCount } from "./db";

export type BackupPayload = {
  version: 1;
  exportedAt: string;
  appConfig: AppConfig;
  env: Record<string, string>;
  meta?: {
    indexCount?: number;
    lastSyncAt?: string | null;
  };
  indexBase64?: string | null;
  includeIndex: boolean;
};

function dataDir() {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function exportBackup(options?: { includeIndex?: boolean }): BackupPayload {
  const includeIndex = options?.includeIndex !== false;
  const { values } = readEnvConfig();
  const appConfig = readAppConfig();

  let indexBase64: string | null = null;
  if (includeIndex) {
    const dbFile = path.join(dataDir(), "index.sqlite");
    if (fs.existsSync(dbFile)) {
      indexBase64 = fs.readFileSync(dbFile).toString("base64");
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appConfig,
    env: values,
    meta: {
      indexCount: indexCount(),
      lastSyncAt: getMeta("last_sync_at"),
    },
    indexBase64,
    includeIndex,
  };
}

export function importBackup(payload: BackupPayload): {
  ok: boolean;
  message: string;
  restored: string[];
} {
  if (!payload || payload.version !== 1) {
    throw new Error("备份格式不正确");
  }

  const restored: string[] = [];

  if (payload.appConfig) {
    writeAppConfig({
      username: payload.appConfig.username || "",
      passwordHash: payload.appConfig.passwordHash || "",
      siteTitle: payload.appConfig.siteTitle || "NotionPan",
      siteDescription: payload.appConfig.siteDescription || "",
      setupCompleted: Boolean(payload.appConfig.setupCompleted),
    });
    restored.push("appConfig");
  }

  if (payload.env && typeof payload.env === "object") {
    writeEnvConfig(payload.env);
    softReloadEnv();
    restored.push("env");
  }

  if (payload.includeIndex && payload.indexBase64) {
    const dbFile = path.join(dataDir(), "index.sqlite");
    // close handled by process restart ideally; overwrite file
    fs.writeFileSync(dbFile, Buffer.from(payload.indexBase64, "base64"));
    restored.push("index");
  }

  return {
    ok: true,
    message: `已恢复: ${restored.join(", ")}`,
    restored,
  };
}
