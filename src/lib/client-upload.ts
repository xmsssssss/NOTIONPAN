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

const CLIENT_SHARE = 40;

export function uploadViaServer(
  file: File,
  folder: string,
  onProgress?: (pct: number, info?: UploadProgressInfo) => void,
): Promise<UploadViaServerResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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
      const text = xhr.responseText || "";
      if (text.length <= parseOffset) return;
      const chunk = text.slice(parseOffset);
      parseOffset = text.length;
      lineBuf += chunk;
      const parts = lineBuf.split("\n");
      lineBuf = parts.pop() || "";
      for (const line of parts) handleLine(line);
    };

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
      if (xhr.readyState >= 3) consumeResponseText();
    };

    xhr.onload = () => {
      if (settled) return;
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

      settled = true;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(streamError || `上传失败: ${file.name}`));
        return;
      }
      if (streamError) {
        reject(new Error(streamError));
        return;
      }
      if (finalResult) {
        resolve(finalResult);
        return;
      }
      reject(new Error(`上传失败: ${file.name}`));
    };

    xhr.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`网络错误: ${file.name}`));
    };

    xhr.ontimeout = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`上传超时: ${file.name}`));
    };

    xhr.open("POST", "/api/files");
    xhr.responseType = "text";
    xhr.send(form);
  });
}
