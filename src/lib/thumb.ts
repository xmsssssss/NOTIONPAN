import fs from "fs";
import path from "path";
import sharp from "sharp";
import { getFile } from "./drive";
import { isCadFile } from "./utils";

function dataDir() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function thumbDir() {
  const dir = path.join(dataDir(), "thumbs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const MAX_EDGE = 360;
const QUALITY = 72;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // 原图/PDF 拉取上限

export function thumbPath(id: string) {
  const bare = String(id || "").replace(/-/g, "").toLowerCase();
  const safe = bare.replace(/[^a-zA-Z0-9_]/g, "") || "unknown";
  return path.join(thumbDir(), `${safe}.webp`);
}

export function isImageFile(mimeType: string, name: string): boolean {
  if (isCadFile(mimeType, name)) return false;
  if (mimeType.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|avif|heic|tiff?|svg|ico)$/i.test(name);
}

export function isPdfFile(mimeType: string, name: string): boolean {
  if (mimeType === "application/pdf") return true;
  return /\.pdf$/i.test(name);
}

/** 是否尝试生成缩略图（失败则前端回退图标） */
export function canAttemptThumb(mimeType: string, name: string): boolean {
  return isImageFile(mimeType, name) || isPdfFile(mimeType, name);
}

export async function getOrCreateThumb(
  id: string,
): Promise<{ buffer: Buffer; contentType: string; cached: boolean }> {
  const out = thumbPath(id);

  if (fs.existsSync(out)) {
    return {
      buffer: fs.readFileSync(out),
      contentType: "image/webp",
      cached: true,
    };
  }

  const file = await getFile(id);
  if (!canAttemptThumb(file.mimeType, file.name)) {
    throw new Error("不支持的缩略图类型");
  }
  if (!file.downloadUrl) {
    throw new Error("暂无下载链接");
  }
  if (file.size > 0 && file.size > MAX_SOURCE_BYTES) {
    throw new Error("源文件过大，跳过缩略图");
  }

  const upstream = await fetch(file.downloadUrl, {
    redirect: "follow",
    headers: { "User-Agent": "NotionPan/1.0" },
  });
  if (!upstream.ok) {
    throw new Error(`拉取源文件失败: ${upstream.status}`);
  }

  const arr = new Uint8Array(await upstream.arrayBuffer());
  if (arr.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("源文件过大，跳过缩略图");
  }

  let pipeline = sharp(arr, {
    // PDF：若 libvips 支持则渲第一页；不支持则抛错由路由处理
    density: isPdfFile(file.mimeType, file.name) ? 96 : undefined,
    pages: 1,
    limitInputPixels: 50_000_000,
  });

  // SVG / 大图
  pipeline = pipeline.rotate().resize({
    width: MAX_EDGE,
    height: MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });

  const buffer = await pipeline.webp({ quality: QUALITY }).toBuffer();
  fs.writeFileSync(out, buffer);
  return { buffer, contentType: "image/webp", cached: false };
}

export function deleteThumb(id: string) {
  try {
    const p = thumbPath(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}
