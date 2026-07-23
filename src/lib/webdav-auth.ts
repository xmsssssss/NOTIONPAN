import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { readAppConfig } from "./app-config";

export type WebDavUser = {
  username: string;
};

/** Basic Auth，账号密码与站点管理员相同 */
export async function authenticateWebDav(
  req: NextRequest | Request,
): Promise<WebDavUser | null> {
  const cfg = readAppConfig();
  if (!cfg.setupCompleted || !cfg.username || !cfg.passwordHash) {
    return null;
  }
  if (cfg.username === "__corrupt__") return null;

  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return null;

  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  const username = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);

  if (username !== cfg.username) return null;
  const ok = await bcrypt.compare(password, cfg.passwordHash);
  if (!ok) return null;
  return { username };
}

export function webDavAuthChallenge(): Response {
  return new Response("WebDAV authorization required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="NotionPan WebDAV"',
      "Content-Type": "text/plain; charset=utf-8",
      DAV: "1, 2",
    },
  });
}
