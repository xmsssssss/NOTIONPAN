import { Client } from "@notionhq/client";
import { getRuntimeEnv, getRuntimeEnvRequired, ensureRuntimeEnvLoaded } from "./runtime-env";
import { formatNetworkError, isRetriableNetworkError } from "./utils";

export function getEnv(name: string): string {
  return getRuntimeEnvRequired(name);
}

export type WorkspaceUploadLimit = {
  maxFileUploadSizeInBytes: number;
  workspaceName: string | null;
};

let cachedUploadLimit: { at: number; value: WorkspaceUploadLimit } | null = null;
const UPLOAD_LIMIT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FREE_LIMIT = 5 * 1024 * 1024;

/** 读取 bot 工作区单文件上传上限（users.me） */
export async function getWorkspaceUploadLimit(
  force = false,
): Promise<WorkspaceUploadLimit> {
  if (
    !force &&
    cachedUploadLimit &&
    Date.now() - cachedUploadLimit.at < UPLOAD_LIMIT_TTL_MS
  ) {
    return cachedUploadLimit.value;
  }
  try {
    const notion = getNotionClient();
    const me = await withNotionRetry(() => notion.users.me({}), "读取工作区限额", 2);
    const bot = (me as {
      type?: string;
      bot?: {
        workspace_name?: string | null;
        workspace_limits?: { max_file_upload_size_in_bytes?: number };
      };
    }).bot;
    const max =
      bot?.workspace_limits?.max_file_upload_size_in_bytes ?? DEFAULT_FREE_LIMIT;
    const value: WorkspaceUploadLimit = {
      maxFileUploadSizeInBytes: max > 0 ? max : DEFAULT_FREE_LIMIT,
      workspaceName: bot?.workspace_name ?? null,
    };
    cachedUploadLimit = { at: Date.now(), value };
    return value;
  } catch {
    const value: WorkspaceUploadLimit = {
      maxFileUploadSizeInBytes: DEFAULT_FREE_LIMIT,
      workspaceName: null,
    };
    cachedUploadLimit = { at: Date.now(), value };
    return value;
  }
}

export function assertWithinUploadLimit(
  size: number,
  limit: WorkspaceUploadLimit,
  formatBytes: (n: number) => string,
): void {
  if (size > limit.maxFileUploadSizeInBytes) {
    throw new Error(
      `文件超过 Notion 工作区上限（${formatBytes(size)} > ${formatBytes(limit.maxFileUploadSizeInBytes)}）。免费约 5MB，付费更大。`,
    );
  }
}

/**
 * 对偶发 ECONNRESET / fetch failed 自动重试。
 * Notion SDK 默认只重试 429/5xx，网络层断连需自行处理。
 */
export async function withNotionRetry<T>(
  fn: () => Promise<T>,
  label = "操作",
  times = 4,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetriableNetworkError(err) || i === times - 1) break;
      // 指数退避 + 抖动，减轻连发重置
      const delay = Math.min(2500, 350 * 2 ** i) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(formatNetworkError(last, label));
}

export function getNotionClient() {
  ensureRuntimeEnvLoaded();
  return new Client({
    auth: getEnv("NOTION_API_KEY"),
    // 默认偏短时，国内网络抖动更容易超时断连
    timeoutMs: 60_000,
    retry: {
      maxRetries: 3,
      initialRetryDelayMs: 800,
      maxRetryDelayMs: 15_000,
    },
  });
}

export function getDatabaseId() {
  return getEnv("NOTION_DATABASE_ID").replace(/-/g, "");
}

export async function getDataSourceId(notion: Client): Promise<string | null> {
  const fromEnv = getRuntimeEnv("NOTION_DATA_SOURCE_ID")?.trim();
  if (fromEnv) return fromEnv;

  try {
    const db = await withNotionRetry(
      () => notion.databases.retrieve({ database_id: getDatabaseId() }),
      "读取数据库",
    );
    const dataSources = (db as { data_sources?: Array<{ id: string }> }).data_sources;
    if (dataSources?.[0]?.id) return dataSources[0].id;
  } catch {
    // ignore
  }
  return null;
}

export function richText(content: string) {
  return [{ type: "text" as const, text: { content: content.slice(0, 2000) } }];
}
