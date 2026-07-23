import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { dispatchWebDav } from "@/lib/webdav-route";
import { normalizeWebDavLogicalPath } from "@/lib/webdav-path";
import { handlePut } from "@/lib/webdav";
import {
  assertWithinUploadLimit,
  getWorkspaceUploadLimit,
} from "@/lib/notion";
import { formatBytes } from "@/lib/utils";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
};

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function logicalPathFromReq(req: NextApiRequest): string {
  const pathQuery = req.query.path;
  if (pathQuery != null) {
    const parts = (Array.isArray(pathQuery) ? pathQuery : [pathQuery])
      .map((p) => String(p ?? ""))
      .filter((p) => p !== "" && p !== "undefined");
    if (parts.length > 0) {
      const segs = parts.map((p) => {
        try {
          return p.includes("%") ? decodeURIComponent(p) : p;
        } catch {
          return p;
        }
      });
      return normalizeWebDavLogicalPath("/" + segs.join("/"));
    }
  }

  const raw = (req.url || "").split("?")[0] || "";
  const m = raw.match(/\/api\/webdav(?:\/(.*))?$/i);
  if (m) {
    if (!m[1]) return "/";
    try {
      return normalizeWebDavLogicalPath("/" + decodeURIComponent(m[1]));
    } catch {
      return normalizeWebDavLogicalPath("/" + m[1]);
    }
  }

  const m2 = raw.match(/\/webdav(?:\/(.*))?$/i);
  if (m2) {
    if (!m2[1]) return "/";
    try {
      return normalizeWebDavLogicalPath("/" + decodeURIComponent(m2[1]));
    } catch {
      return normalizeWebDavLogicalPath("/" + m2[1]);
    }
  }

  return "/";
}

function putTmpDir() {
  const dir = path.join(
    process.env.DATA_DIR || path.join(process.cwd(), "data"),
    "tmp",
    "webdav-put",
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeUnlinkFile(p: string) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

/** PUT：Node 流直接落盘，不经 Request/arrayBuffer；失败必删临时文件 */
async function handlePutStream(
  req: NextApiRequest,
  res: NextApiResponse,
  logical: string,
) {
  let limit;
  try {
    limit = await getWorkspaceUploadLimit();
  } catch {
    limit = {
      maxFileUploadSizeInBytes: 5 * 1024 * 1024,
      workspaceName: null as string | null,
    };
  }
  const maxBytes = limit.maxFileUploadSizeInBytes;
  const declared = Number(req.headers["content-length"] || "0");
  if (declared > 0) {
    try {
      assertWithinUploadLimit(declared, limit, formatBytes);
    } catch (e) {
      res
        .status(413)
        .setHeader("Content-Type", "text/plain; charset=utf-8")
        .end(e instanceof Error ? e.message : "File too large");
      return;
    }
  }

  const tmpPath = path.join(
    putTmpDir(),
    `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.bin`,
  );

  let total = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(tmpPath);
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try {
          req.destroy();
        } catch {
          // ignore
        }
        try {
          ws.destroy();
        } catch {
          // ignore
        }
        reject(err);
      };
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          fail(
            new Error(
              `File exceeds Notion limit (${formatBytes(maxBytes)})`,
            ),
          );
        }
      });
      req.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
      pipeline(req, ws)
        .then(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        })
        .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
    });
  } catch (e) {
    safeUnlinkFile(tmpPath);
    const msg = e instanceof Error ? e.message : "Upload failed";
    const status = /exceeds|上限|过大|limit/i.test(msg) ? 413 : 500;
    if (!res.headersSent) {
      res.status(status).setHeader("Content-Type", "text/plain; charset=utf-8").end(msg);
    }
    return;
  }

  if (total === 0) {
    try {
      total = fs.statSync(tmpPath).size;
    } catch {
      total = 0;
    }
  }

  try {
    const host = req.headers.host || "127.0.0.1:3000";
    const headers = new Headers();
    const auth = req.headers.authorization;
    if (auth) headers.set("authorization", auth);
    const ct = req.headers["content-type"];
    if (typeof ct === "string") headers.set("content-type", ct);
    headers.set("x-webdav-path", encodeURIComponent(logical));
    headers.set("content-length", String(total));

    const fakeReq = new Request(
      `http://${host}/webdav${logical === "/" ? "" : logical}`,
      { method: "PUT", headers },
    );

    const response = await handlePut(
      fakeReq as unknown as import("next/server").NextRequest,
      logical,
      { tempFilePath: tmpPath, tempFileSize: total },
    );

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      res.setHeader(key, value);
    });
    const text = await response.text();
    res.end(text || undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    if (!res.headersSent) {
      res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8").end(msg);
    }
  } finally {
    safeUnlinkFile(tmpPath);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const method = (req.method || "GET").toUpperCase();
    const logical = logicalPathFromReq(req);

    console.info(
      "[webdav-pages]",
      method,
      "logical=",
      JSON.stringify(logical),
      "query.path=",
      JSON.stringify(req.query.path),
      "url=",
      req.url,
    );

    // PUT 单独流式落盘，避免 readRawBody 撑爆内存
    if (method === "PUT") {
      // 鉴权：复用 dispatch 前的 Basic 检查
      const { authenticateWebDav, webDavAuthChallenge } = await import(
        "@/lib/webdav-auth"
      );
      const host = req.headers.host || "127.0.0.1:3000";
      const headers = new Headers();
      if (req.headers.authorization) {
        headers.set("authorization", req.headers.authorization);
      }
      const authReq = new Request(`http://${host}/webdav/`, {
        method: "PUT",
        headers,
      });
      const user = await authenticateWebDav(
        authReq as unknown as import("next/server").NextRequest,
      );
      if (!user) {
        const challenge = webDavAuthChallenge();
        res.status(challenge.status);
        challenge.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await challenge.text());
        return;
      }
      await handlePutStream(req, res, logical);
      return;
    }

    const host = req.headers.host || "127.0.0.1:3000";
    const pathForUrl = logical === "/" ? "/webdav/" : `/webdav${logical}`;
    const url = `http://${host}${pathForUrl}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      if (key === "transfer-encoding" || key === "connection") continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }
    headers.set("x-webdav-path", encodeURIComponent(logical));

    let body: BodyInit | undefined;
    const needsBody =
      method === "PROPFIND" ||
      method === "PROPPATCH" ||
      method === "LOCK" ||
      method === "POST";
    if (needsBody) {
      const buf = await readRawBody(req);
      if (buf.byteLength > 0) body = new Uint8Array(buf);
    }

    const requestInit: RequestInit & { duplex?: string } = {
      method,
      headers,
    };
    if (body) {
      requestInit.body = body;
      requestInit.duplex = "half";
    }

    const request = new Request(url, requestInit);
    const response = await dispatchWebDav(
      request as unknown as import("next/server").NextRequest,
    );

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      res.setHeader(key, value);
    });

    if (method === "HEAD" || response.status === 204 || response.status === 304) {
      res.end();
      return;
    }

    const ab = await response.arrayBuffer();
    if (ab.byteLength === 0) {
      res.end();
      return;
    }
    res.send(Buffer.from(ab));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "WebDAV handler error";
    console.error("[webdav-pages]", msg);
    if (!res.headersSent) {
      res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8").end(msg);
    }
  }
}
