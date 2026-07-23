import type { NextRequest } from "next/server";
import {
  authenticateWebDav,
  webDavAuthChallenge,
} from "@/lib/webdav-auth";
import {
  handleCopy,
  handleDelete,
  handleGetHead,
  handleMkcol,
  handleMove,
  handleOptions,
  handlePropfind,
  handlePut,
  methodFromRequest,
} from "@/lib/webdav";
import { normalizeWebDavLogicalPath } from "@/lib/webdav-path";

function pathFromRequest(req: NextRequest | Request): string {
  // Pages 层必须设置；值为 encodeURIComponent（Header 不能直接放 Unicode）
  const header = (
    req.headers.get("x-webdav-path") ||
    req.headers.get("X-WebDAV-Path") ||
    ""
  ).trim();
  if (header) {
    let decoded = header;
    try {
      decoded = decodeURIComponent(header);
    } catch {
      // 未编码的 Latin-1 路径
    }
    return normalizeWebDavLogicalPath(decoded);
  }

  try {
    // URL pathname 已是 percent-encoded，URL 构造器会 decode
    return normalizeWebDavLogicalPath(new URL(req.url).pathname);
  } catch {
    return "/";
  }
}

export async function dispatchWebDav(
  req: NextRequest | Request,
): Promise<Response> {
  const method = methodFromRequest(req as NextRequest);

  if (method === "OPTIONS") {
    return handleOptions();
  }

  const user = await authenticateWebDav(req as NextRequest);
  if (!user) {
    return webDavAuthChallenge();
  }

  const path = pathFromRequest(req);
  console.info("[webdav]", method, "path=", JSON.stringify(path));

  try {
    switch (method) {
      case "OPTIONS":
        return handleOptions();
      case "PROPFIND":
        return await handlePropfind(req as NextRequest, path);
      case "GET":
        return await handleGetHead(path, "GET", req as NextRequest);
      case "HEAD":
        return await handleGetHead(path, "HEAD", req as NextRequest);
      case "PUT":
        return await handlePut(req as NextRequest, path);
      case "DELETE":
        return await handleDelete(path);
      case "MKCOL":
        return await handleMkcol(path);
      case "MOVE":
        return await handleMove(req as NextRequest, path);
      case "COPY":
        return await handleCopy(req as NextRequest, path);
      case "LOCK":
      case "UNLOCK":
      case "PROPPATCH":
        return new Response("Not implemented", { status: 501 });
      case "POST":
        return await handleMkcol(path);
      default:
        return new Response(`Method ${method} not allowed`, {
          status: 405,
          headers: {
            Allow:
              "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY",
          },
        });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "WebDAV error";
    console.error("[webdav-error]", method, path, msg);
    return new Response(msg, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
