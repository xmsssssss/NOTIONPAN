/**
 * 批量操作的协议与客户端读取（前后端共用类型）。
 * 服务端以 NDJSON 流逐项回报，客户端边读边更新进度。
 */
import type { DriveFile } from "./types";

export type BatchAction = "delete" | "move";

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
 * 流中途断开（没收到 done）时，用已收到的逐项结果拼出部分结果并标记 interrupted。
 */
export async function consumeBatchResponse(
  res: Response,
  onProgress?: (p: BatchProgress) => void,
): Promise<BatchResult & { interrupted: boolean }> {
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
  } catch {
    // 用户中止（AbortController）或网络断开：返回已完成的部分
  }
  if (serverError !== null && succeeded.length === 0 && failed.length === 0) {
    throw new Error(serverError);
  }
  return { succeeded, failed, files, interrupted: true };
}
