/**
 * 从各种来源解析 WebDAV 逻辑路径（统一成 /a/b 形式）
 */
export function normalizeWebDavLogicalPath(input: string): string {
  let s = (input || "/").replace(/\\/g, "/").trim();
  if (!s) return "/";

  // 去掉协议 host
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      // keep
    }
  }

  // 去掉查询
  s = s.split("?")[0] || "/";

  // 去掉已知前缀（可重复剥）
  for (let i = 0; i < 3; i++) {
    const lower = s.toLowerCase();
    if (lower.startsWith("/api/webdav")) {
      s = s.slice("/api/webdav".length) || "/";
      continue;
    }
    if (lower.startsWith("/webdav")) {
      s = s.slice("/webdav".length) || "/";
      continue;
    }
    break;
  }

  if (!s.startsWith("/")) s = `/${s}`;
  s = s.replace(/\/{2,}/g, "/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);

  // 禁止 .. 逃逸
  const parts: string[] = [];
  for (const seg of s.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  if (!parts.length) return "/";
  return `/${parts.join("/")}`;
}

/** 从 Next pages req 提取逻辑路径 */
export function logicalPathFromPagesReq(req: {
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}): string {
  // 1) catch-all query.path（Next 通常已 decode 成 Unicode）
  const pathQuery = req.query?.path;
  if (pathQuery != null) {
    const parts = (Array.isArray(pathQuery) ? pathQuery : [pathQuery])
      .map((p) => String(p ?? ""))
      .filter((p) => p !== "" && p !== "undefined");
    if (parts.length > 0) {
      const segs = parts.map((p) => {
        try {
          // 若仍是 %xx 则 decode；已是 Unicode 再 decode 可能抛错或二次解码
          return p.includes("%") ? decodeURIComponent(p) : p;
        } catch {
          return p;
        }
      });
      return normalizeWebDavLogicalPath("/" + segs.join("/"));
    }
  }

  // 2) header（可能是 encodeURIComponent 后的）
  const h = headerOne(req.headers, "x-webdav-path");
  if (h) {
    try {
      return normalizeWebDavLogicalPath(
        h.includes("%") ? decodeURIComponent(h) : h,
      );
    } catch {
      return normalizeWebDavLogicalPath(h);
    }
  }

  // 3) raw url（含 %E3%82%B3…）
  if (req.url) {
    return normalizeWebDavLogicalPath(req.url);
  }

  return "/";
}

function headerOne(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string {
  if (!headers) return "";
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] || "");
  return String(v || "");
}
