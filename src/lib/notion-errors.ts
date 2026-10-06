/**
 * Notion API 错误 / 响应的纯函数解析（不依赖运行时配置，便于单元测试）。
 */

type ApiErrorLike = {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  additional_data?: Record<string, string | string[] | undefined>;
};

function asApiError(err: unknown): ApiErrorLike | null {
  return err && typeof err === "object" ? (err as ApiErrorLike) : null;
}

/** additional_data 的值可能是 string 或 string[]，统一取第一个字符串 */
function firstString(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return typeof v[0] === "string" && v[0] ? v[0] : null;
  return typeof v === "string" && v ? v : null;
}

/**
 * 免费多成员工作区达到 1000 块上限后（宽限期结束），创建块的写入返回
 * 403 restricted_resource + additional_data.block_limit。
 * 重试无效，需要升级套餐或改用个人访问令牌（PAT）。
 */
export function isBlockLimitError(err: unknown): boolean {
  const e = asApiError(err);
  return (
    !!e &&
    e.status === 403 &&
    e.code === "restricted_resource" &&
    !!firstString(e.additional_data?.block_limit)
  );
}

export const BLOCK_LIMIT_MESSAGE =
  "Notion 工作区的免费块额度已用完（多成员免费工作区上限 1000 块），无法再创建页面。" +
  "请升级 Notion 套餐，或改用个人访问令牌（PAT，不受此限制），" +
  "也可设置 NOTION_SKIP_PREVIEW_BLOCK=1 让每个文件少占一个块。";

/**
 * 写入返回 503 但 Notion 已保存时，additional_data.committed_resource_id
 * 给出已创建对象的 ID。返回 null 表示无法确认已提交。
 */
export function committedResourceId(err: unknown): string | null {
  const e = asApiError(err);
  if (!e || e.status !== 503) return null;
  return firstString(e.additional_data?.committed_resource_id);
}

/**
 * 非幂等创建（pages.create 等）遇到「已保存但响应超时」的 503 时，
 * 按 committed_resource_id 读回对象，避免重复创建或产生孤儿页。
 * 其他错误原样抛出。
 */
export async function createWithCommitRecovery<T>(
  create: () => Promise<T>,
  retrieve: (id: string) => Promise<T>,
): Promise<T> {
  try {
    return await create();
  } catch (err) {
    const id = committedResourceId(err);
    if (!id) throw err;
    try {
      return await retrieve(id);
    } catch {
      // 读回失败：抛出原始 503，保留 Notion 的说明
      throw err;
    }
  }
}

export type TokenIdentity = {
  /** bot = 内部集成（工作区所有）；person = 归属个人的令牌（PAT） */
  tokenType: "bot" | "person" | null;
  /** users.me 的 bot.workspace_limits；缺失时为 null */
  maxFileUploadSizeInBytes: number | null;
  workspaceName: string | null;
};

/**
 * 解析 users.me。实测：PAT 与内部集成都返回 type=bot（且都带 workspace_limits），
 * 区别在 bot.owner.type：内部集成为 "workspace"，PAT 为 "user"。
 * 兼容直接返回 type=person 的情况。
 */
export function parseUsersMe(me: unknown): TokenIdentity {
  const u = (me && typeof me === "object" ? me : {}) as {
    type?: unknown;
    bot?: {
      owner?: { type?: unknown };
      workspace_name?: unknown;
      workspace_limits?: { max_file_upload_size_in_bytes?: unknown };
    };
  };
  let tokenType: TokenIdentity["tokenType"] = null;
  if (u.type === "person") tokenType = "person";
  else if (u.type === "bot") tokenType = u.bot?.owner?.type === "user" ? "person" : "bot";
  const rawMax = u.bot?.workspace_limits?.max_file_upload_size_in_bytes;
  const max = typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0 ? rawMax : null;
  const name = u.bot?.workspace_name;
  return {
    tokenType,
    maxFileUploadSizeInBytes: max,
    workspaceName: typeof name === "string" && name ? name : null,
  };
}

/** 解析用户配置的上传上限（字节）；非法值返回 null */
export function parseUploadLimitOverride(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
