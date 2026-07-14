import fs from "fs";
import path from "path";
import sharp from "sharp";
import { getFile } from "./drive";

const THUMB_DIR = path.join(process.cwd(), "data", "thumbs");
const MAX_EDGE = 360;
const QUALITY = 72;

function ensureDir() {
  if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
}

export function thumbPath(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(THUMB_DIR, `${safe}.webp`);
}

export function isImageFile(mimeType: string, name: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|avif|heic|tiff?)$/i.test(name);
}

export async function getOrCreateThumb(
  id: string,
): Promise<{ buffer: Buffer; contentType: string; cached: boolean }> {
  ensureDir();
  const out = thumbPath(id);

  if (fs.existsSync(out)) {
    return {
      buffer: fs.readFileSync(out),
      contentType: "image/webp",
      cached: true,
    };
  }

  const file = await getFile(id);
  if (!isImageFile(file.mimeType, file.name)) {
    throw new Error("仅支持图片缩略图");
  }
  if (!file.downloadUrl) {
    throw new Error("暂无下载链接");
  }

  const upstream = await fetch(file.downloadUrl);
  if (!upstream.ok) {
    throw new Error(`拉取原图失败: ${upstream.status}`);
  }

  const arr = new Uint8Array(await upstream.arrayBuffer());
  const buffer = await sharp(arr)
    .rotate()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: QUALITY })
    .toBuffer();

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
