/**
 * 批量操作的协议与客户端读取（前后端共用类型）。
 * 服务端以 NDJSON 流逐项回报，客户端边读边更新进度。
 */
import type { DriveFile } from "./types";

export type BatchAction = "delete" | "move";

/** 单次请求上限（服务端校验）；客户端按此分组依次请求 */
export const MAX_BATCH = 200;

export type BatchFailure = { id: string; error: string };

export type BatchEvent =
  | { type: "start"; total: number }
  | { type: "item"; done: number; total: number; id: string; ok: boolean; error?: string; file?: DriveFile }
  | { type: "done"; succeeded: string[]; failed: BatchFailure[]; files: DriveFile[] }
  | { type: "error"; error: string };

export type BatchResult = {
  succeeded: string[];
  failed: BatchFailure[];
  files: DriveFile[];
};

export type BatchProgress = { done: number; total: number };

/**
 * 批量执行结果。
 * - interrupted：没有全部处理完
 * - error：非用户主动停止的中断原因（服务端报错 / 连接断开）；用户点停止时为空
 */
export type BatchOutcome = BatchResult & { interrupted: boolean; error?: string };

function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

/** 逐行解析 NDJSON 流；跨 chunk 的半行会拼接，坏行忽略 */
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          yield JSON.parse(s) as T;
        } catch {
          // ignore malformed line
        }
      }
    }
    buf += decoder.decode();
    const s = buf.trim();
    if (s) {
      try {
        yield JSON.parse(s) as T;
      } catch {
        // ignore
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 读取批量接口响应：逐项回调进度，返回最终汇总。
 * 流中途断开（没收到 done）时，用已收到的逐项结果拼出部分结果并标记 interrupted；
 * 非用户主动停止（signal 未 abort）的中断会带上 error。
 */
export async function consumeBatchResponse(
  res: Response,
  onProgress?: (p: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<BatchOutcome> {
  if (!res.ok || !res.body) {
    let msg = `批量操作失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = String(data.error);
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const succeeded: string[] = [];
  const failed: BatchFailure[] = [];
  const files: DriveFile[] = [];

  let serverError: string | null = null;
  let aborted = false;
  try {
    for await (const ev of readNdjson<BatchEvent>(res.body)) {
      if (ev.type === "start") {
        onProgress?.({ done: 0, total: ev.total });
      } else if (ev.type === "item") {
        if (ev.ok) {
          succeeded.push(ev.id);
          if (ev.file) files.push(ev.file);
        } else {
          failed.push({ id: ev.id, error: ev.error || "操作失败" });
        }
        onProgress?.({ done: ev.done, total: ev.total });
      } else if (ev.type === "done") {
        return { succeeded: ev.succeeded, failed: ev.failed, files: ev.files, interrupted: false };
      } else if (ev.type === "error") {
        serverError = ev.error;
        break;
      }
    }
  } catch (e) {
    // 用户中止（AbortController）或网络断开：返回已完成的部分
    aborted = Boolean(signal?.aborted) || isAbortError(e);
  }
  if (serverError !== null && succeeded.length === 0 && failed.length === 0) {
    throw new Error(serverError);
  }
  const error = aborted ? undefined : (serverError ?? "连接中断");
  return { succeeded, failed, files, interrupted: true, error };
}

/**
 * 按 MAX_BATCH 分组依次请求，进度按总数累加。
 * - 用户停止（signal abort）：不再发后续组，返回已完成部分
 * - 某组失败：已有进展则返回部分结果并带 error；一个都没处理则抛出
 */
export async function runBatchChunked(
  send: (ids: string[], signal?: AbortSignal) => Promise<Response>,
  ids: readonly string[],
  opts: { onProgress?: (p: BatchProgress) => void; signal?: AbortSignal; chunkSize?: number } = {},
): Promise<BatchOutcome> {
  const { onProgress, signal } = opts;
  const size = Math.max(1, Math.floor(opts.chunkSize ?? MAX_BATCH));
  const total = ids.length;
  const acc: BatchResult = { succeeded: [], failed: [], files: [] };
  const processed = () => acc.succeeded.length + acc.failed.length;
  const partial = (error?: string): BatchOutcome => ({ ...acc, interrupted: true, error });

  onProgress?.({ done: 0, total });
  for (let start = 0; start < total; start += size) {
    if (signal?.aborted) return partial();
    const chunk = ids.slice(start, start + size);
    const offset = start;
    let r: BatchOutcome;
    try {
      const res = await send(chunk, signal);
      r = await consumeBatchResponse(
        res,
        (p) => onProgress?.({ done: offset + p.done, total }),
        signal,
      );
    } catch (e) {
      // 响应头到达前就点了停止：服务端可能已处理一部分，由调用方刷新为准
      if (signal?.aborted || isAbortError(e)) return partial();
      if (processed() === 0) throw e;
      return partial(e instanceof Error ? e.message : "批量操作失败");
    }
    acc.succeeded.push(...r.succeeded);
    acc.failed.push(...r.failed);
    acc.files.push(...r.files);
    if (r.interrupted) return partial(r.error);
  }
  return { ...acc, interrupted: false };
}
