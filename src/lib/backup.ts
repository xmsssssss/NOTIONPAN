import fs from "fs";
import path from "path";
import { readAppConfig, writeAppConfig, type AppConfig } from "./app-config";
import { readEnvConfig, writeEnvConfig, softReloadEnv } from "./runtime-env";
import {
  closeDb,
  exportIndexJson,
  getMeta,
  importIndexJson,
  indexCount,
} from "./db";

export type BackupPayload = {
  version: 1;
  exportedAt: string;
  appConfig: AppConfig;
  env: Record<string, string>;
  meta?: {
    indexCount?: number;
    lastSyncAt?: string | null;
  };
  /** 旧版：sqlite 二进制 base64（已废弃，导入时忽略） */
  indexBase64?: string | null;
  /** 新版：JSON 索引文本 */
  indexJson?: string | null;
  includeIndex: boolean;
};

function dataDir() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function exportBackup(options?: { includeIndex?: boolean }): BackupPayload {
  const includeIndex = options?.includeIndex !== false;
  const { values } = readEnvConfig();
  const appConfig = readAppConfig();

  let indexJson: string | null = null;
  if (includeIndex) {
    try {
      indexJson = exportIndexJson();
    } catch {
      indexJson = null;
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appConfig,
    env: values,
    meta: {
      indexCount: (() => {
        try {
          return indexCount();
        } catch {
          return 0;
        }
      })(),
      lastSyncAt: (() => {
        try {
          return getMeta("last_sync_at");
        } catch {
          return null;
        }
      })(),
    },
    indexJson,
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
      autoPlay:
        typeof payload.appConfig.autoPlay === "boolean"
          ? payload.appConfig.autoPlay
          : true,
      siteIcon: payload.appConfig.siteIcon || "N",
      setupCompleted: Boolean(payload.appConfig.setupCompleted),
    });
    restored.push("appConfig");
  }

  if (payload.env && typeof payload.env === "object") {
    writeEnvConfig(payload.env);
    softReloadEnv();
    restored.push("env");
  }

  if (payload.includeIndex) {
    if (payload.indexJson) {
      closeDb();
      importIndexJson(payload.indexJson);
      restored.push("index");
    } else if (payload.indexBase64) {
      // 兼容旧备份里的 sqlite 文件：仅落盘，当前运行时不再读取 sqlite
      const dbFile = path.join(dataDir(), "index.sqlite.legacy");
      fs.writeFileSync(dbFile, Buffer.from(payload.indexBase64, "base64"));
      restored.push("index(legacy-sqlite-file-only)");
    }
  }

  return {
    ok: true,
    message: `已恢复: ${restored.join(", ")}`,
    restored,
  };
}
