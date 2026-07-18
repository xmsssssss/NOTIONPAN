/** 浏览器 → 本服务 POST /api/files → 服务端调用 Notion（密钥不离开服务器）
 *
 * 进度两段：
 * - 0–40%：浏览器上传到本服务（XHR upload）
 * - 40–100%：本服务同步到 Notion（响应 NDJSON 流）
 */

export type UploadViaServerResult = {
  skipped: boolean;
};

export type UploadProgressInfo = {
  pct: number;
  message?: string;
  phase?: string;
};

export type UploadViaServerHandle = {
  promise: Promise<UploadViaServerResult>;
  abort: () => void;
};

const CLIENT_SHARE = 40;
/** 单文件：客户端上传 + Notion 同步；大文件/慢网可放宽 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export function uploadViaServer(
  file: File,
  folder: string,
  onProgress?: (pct: number, info?: UploadProgressInfo) => void,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): UploadViaServerHandle {
  let xhr: XMLHttpRequest | null = null;
  let abortExternal = false;

  const promise = new Promise<UploadViaServerResult>((resolve, reject) => {
    xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);
    form.append("stream", "1");

    let settled = false;
    let parseOffset = 0;
    let lineBuf = "";
    let lastPct = 0;
    let finalResult: UploadViaServerResult | null = null;
    let streamError: string | null = null;

    const report = (pct: number, info?: UploadProgressInfo) => {
      const next = Math.max(lastPct, Math.min(100, Math.round(pct)));
      lastPct = next;
      onProgress?.(next, info ? { ...info, pct: next } : { pct: next });
    };

    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const settleResolve = (result: UploadViaServerResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const handleLine = (line: string) => {
      const t = line.trim();
      if (!t) return;
      let data: {
        type?: string;
        pct?: number;
        message?: string;
        phase?: string;
        error?: string;
        skipped?: boolean;
      };
      try {
        data = JSON.parse(t) as typeof data;
      } catch {
        return;
      }
      if (data.type === "progress") {
        const pct = typeof data.pct === "number" ? data.pct : lastPct;
        report(pct, {
          pct,
          message: data.message,
          phase: data.phase,
        });
      } else if (data.type === "done") {
        finalResult = { skipped: Boolean(data.skipped) };
        report(100, {
          pct: 100,
          message: data.skipped ? "已跳过" : "完成",
          phase: "done",
        });
      } else if (data.type === "error") {
        streamError = data.error || "上传失败";
      }
    };

    const consumeResponseText = () => {
      if (!xhr) return;
      const text = xhr.responseText || "";
      if (text.length <= parseOffset) return;
      const chunk = text.slice(parseOffset);
      parseOffset = text.length;
      lineBuf += chunk;
      const parts = lineBuf.split("\n");
      lineBuf = parts.pop() || "";
      for (const line of parts) handleLine(line);
    };

    const onAbortSignal = () => {
      abortExternal = true;
      try {
        xhr?.abort();
      } catch {
        // ignore
      }
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        settleReject(new Error("上传已取消"));
        return;
      }
      options.signal.addEventListener("abort", onAbortSignal, { once: true });
    }

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      // 请求体上传：映射到 0–40%
      const ratio = ev.total > 0 ? ev.loaded / ev.total : 0;
      const pct = Math.min(CLIENT_SHARE, Math.round(ratio * CLIENT_SHARE));
      report(pct, {
        pct,
        message: pct >= CLIENT_SHARE ? "已到服务器…" : "上传到服务器…",
        phase: "client",
      });
    };

    xhr.upload.onload = () => {
      // 请求体发完，等待 Notion 侧进度
      report(CLIENT_SHARE, {
        pct: CLIENT_SHARE,
        message: "已到服务器，同步到 Notion…",
        phase: "received",
      });
    };

    xhr.onprogress = () => {
      // 响应流逐步到达
      consumeResponseText();
    };

    xhr.onreadystatechange = () => {
      // readyState 3 LOADING / 4 DONE 时解析 NDJSON
      if (xhr && xhr.readyState >= 3) consumeResponseText();
    };

    xhr.onload = () => {
      if (settled || !xhr) return;
      consumeResponseText();
      if (lineBuf.trim()) handleLine(lineBuf);

      // 非流式/旧响应兜底
      if (!finalResult && !streamError && xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText || "{}") as {
            error?: string;
            skipped?: boolean;
          };
          if (data.error) {
            streamError = data.error;
          } else {
            finalResult = { skipped: Boolean(data.skipped) };
            report(100);
          }
        } catch {
          // ignore
        }
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        settleReject(new Error(streamError || `上传失败: ${file.name}`));
        return;
      }
      if (streamError) {
        settleReject(new Error(streamError));
        return;
      }
      if (finalResult) {
        settleResolve(finalResult);
        return;
      }
      settleReject(new Error(`上传失败: ${file.name}`));
    };

    xhr.onerror = () => {
      settleReject(new Error(`网络错误: ${file.name}`));
    };

    xhr.ontimeout = () => {
      settleReject(new Error(`上传超时: ${file.name}`));
    };

    xhr.onabort = () => {
      settleReject(
        new Error(abortExternal || options?.signal?.aborted ? "上传已取消" : `上传已取消: ${file.name}`),
      );
    };

    xhr.open("POST", "/api/files");
    xhr.responseType = "text";
    xhr.timeout =
      typeof options?.timeoutMs === "number" && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    xhr.send(form);
  });

  return {
    promise,
    abort: () => {
      abortExternal = true;
      try {
        xhr?.abort();
      } catch {
        // ignore
      }
    },
  };
}
