import { Client } from "@notionhq/client";
import { getRuntimeEnv, getRuntimeEnvRequired, ensureRuntimeEnvLoaded } from "./runtime-env";
import { formatNetworkError, isConnectFailure, isRetriableNetworkError } from "./utils";

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

export type NotionRetryOptions = {
  /**
   * 请求是否幂等（读取、按值覆盖的更新等），默认 true。
   * 非幂等写入（创建页面 / 数据库、追加块）在超时或连接中断后，Notion 可能
   * 已经执行成功，盲目重试会产生重复内容；此时只重试「请求未发出」的错误。
   */
  idempotent?: boolean;
};

/** SDK 抛出的 HTTP 错误（带 status）：已有明确业务含义，原样抛出以保留 code/status */
function isHttpApiError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    typeof (err as { status?: unknown }).status === "number" &&
    typeof (err as { code?: unknown }).code === "string"
  );
}

/**
 * 进程内全局令牌桶：官方对每个连接按 60 秒窗口限速
 * （Business/Enterprise 600 次/分，其他 180 次/分，约 3 次/秒），
 * 并且工作区内所有连接共享额度。这里统一排队，避免批量操作瞬间耗尽额度。
 * 可用 NOTION_RATE_LIMIT_PER_SECOND 调整（Business 及以上可调大）。
 */
const RATE_BURST = 10;
let rateTokens = RATE_BURST;
let rateRefilledAt = Date.now();
let ratePausedUntil = 0;

function ratePerSecond(): number {
  const n = Number(process.env.NOTION_RATE_LIMIT_PER_SECOND);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

async function acquireRateToken(): Promise<void> {
  for (;;) {
    const now = Date.now();
    if (now < ratePausedUntil) {
      await new Promise((r) => setTimeout(r, ratePausedUntil - now));
      continue;
    }
    const perSec = ratePerSecond();
    rateTokens = Math.min(RATE_BURST, rateTokens + ((now - rateRefilledAt) / 1000) * perSec);
    rateRefilledAt = now;
    if (rateTokens >= 1) {
      rateTokens -= 1;
      return;
    }
    await new Promise((r) => setTimeout(r, Math.ceil(((1 - rateTokens) / perSec) * 1000)));
  }
}

/** SDK 重试用尽后仍 429/529：按 Retry-After 暂停全局队列 */
function noteRateLimited(err: unknown): void {
  const e = err as {
    status?: number;
    code?: string;
    headers?: { get?: (k: string) => string | null } | Record<string, string>;
    additional_data?: Record<string, string | string[]>;
  };
  if (e?.status !== 429 && e?.status !== 529) return;
  if (e.additional_data?.rate_limit_reason === "public_api_request_blocked") return;
  const h = e.headers;
  const fromHeader =
    h && typeof (h as { get?: unknown }).get === "function"
      ? (h as { get: (k: string) => string | null }).get("retry-after")
      : (h as Record<string, string> | undefined)?.["retry-after"];
  const fromBody = e.additional_data?.retry_after;
  const sec = Number(fromHeader ?? (Array.isArray(fromBody) ? fromBody[0] : fromBody));
  const waitMs = (Number.isFinite(sec) && sec > 0 ? Math.min(sec, 120) : 5) * 1000;
  ratePausedUntil = Math.max(ratePausedUntil, Date.now() + waitMs);
}

/**
 * 对偶发 ECONNRESET / fetch failed 自动重试。
 * 429 / 529 / 5xx 由 Notion SDK 自身按 Retry-After 处理（5xx 仅 GET/DELETE），
 * 这里只补网络层断连。API 错误原样抛出，保留 code / status / additional_data。
 */
export async function withNotionRetry<T>(
  fn: () => Promise<T>,
  label = "操作",
  times = 4,
  options: NotionRetryOptions = {},
): Promise<T> {
  const idempotent = options.idempotent ?? true;
  const canRetry = idempotent ? isRetriableNetworkError : isConnectFailure;
  let last: unknown;
  for (let i = 0; i < times; i++) {
    try {
      await acquireRateToken();
      return await fn();
    } catch (err) {
      last = err;
      noteRateLimited(err);
      if (isHttpApiError(err)) throw err;
      if (!canRetry(err) || i === times - 1) break;
      // 指数退避 + 抖动，减轻连发重置
      const delay = Math.min(2500, 350 * 2 ** i) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(formatNetworkError(last, label), { cause: last });
}

/**
 * 显式固定 Notion-Version，避免升级 SDK 时默认版本被悄悄改变。
 * 2026-03-11：archived → in_trash，append children 的 after → position。
 * 可用 NOTION_API_VERSION 临时回退。
 */
export const NOTION_API_VERSION = "2026-03-11";

let cachedClient: { key: string; client: Client } | null = null;

export function getNotionClient(): Client {
  ensureRuntimeEnvLoaded();
  const auth = getEnv("NOTION_API_KEY");
  const notionVersion = process.env.NOTION_API_VERSION?.trim() || NOTION_API_VERSION;
  // Client 无状态，复用即可；token / 版本变化（后台改配置）时重建
  const key = `${auth}|${notionVersion}`;
  if (cachedClient?.key === key) return cachedClient.client;
  const client = new Client({
    auth,
    notionVersion,
    // 默认偏短时，国内网络抖动更容易超时断连
    timeoutMs: 60_000,
    retry: {
      maxRetries: 3,
      initialRetryDelayMs: 800,
      maxRetryDelayMs: 15_000,
    },
  });
  cachedClient = { key, client };
  return client;
}

/** 移入回收站（2026-03-11 起统一使用 in_trash，archived 已废弃） */
export async function trashPage(
  notion: Client,
  pageId: string,
  label = "删除文件",
  times = 4,
): Promise<void> {
  await withNotionRetry(
    () => notion.pages.update({ page_id: pageId, in_trash: true }),
    label,
    times,
  );
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
