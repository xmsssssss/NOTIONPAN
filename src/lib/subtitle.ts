import type { DriveFile } from "./types";

const SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;
const LYRIC_EXT = /\.lrc$/i;

export type Cue = {
  start: number;
  end: number;
  text: string;
};

export function isSubtitleFile(name: string): boolean {
  return SUB_EXT.test(name);
}

export function isLyricFile(name: string): boolean {
  return LYRIC_EXT.test(name);
}

/** 是否为媒体轨（不参与字幕/歌词候选） */
function isMediaTrack(f: DriveFile): boolean {
  if (f.kind === "video" || f.kind === "audio") return true;
  // 保险：扩展名也排除音视频
  return /\.(mp3|wav|ogg|m4a|flac|aac|wma|opus|mp4|webm|mov|mkv|avi)$/i.test(f.name);
}

/** 媒体主文件名（去扩展名，小写，仅去掉首尾空白） */
function mediaStem(name: string): string {
  return name.replace(/\.[^./\\]+$/, "").toLowerCase().trim();
}

/**
 * 是否与媒体文件名匹配：
 * - 完全同名：song.mp3 ↔ song.lrc
 * - 媒体名包含歌词/字幕主名：长歌名.mp3 ↔ 短名.lrc（歌词名在歌曲名内）
 * - 带语言后缀：song.zh.srt / song_en.lrc
 */
function isNameMatched(mediaName: string, trackName: string): boolean {
  const m = mediaStem(mediaName);
  const t = mediaStem(trackName);
  if (!m || !t) return false;
  if (t === m) return true;
  // song.zh / song_en / song-chs
  if (t.startsWith(`${m}.`) || t.startsWith(`${m}_`) || t.startsWith(`${m}-`)) return true;
  // 歌曲名包含歌词名（用户要求：歌词名称在歌曲名称内即可）
  // 要求歌词主名至少 2 字符，避免过短误匹配
  if (t.length >= 2 && m.includes(t)) return true;
  // 反向：歌词名以歌曲名开头（movie.zh.lrc 已在上面处理；此处兼容 songxxx.lrc）
  if (m.length >= 2 && t.includes(m)) return true;
  return false;
}

/** 同目录字幕：仅保留与视频文件名匹配的 */
export function listSubtitleFiles(mediaName: string, siblings: DriveFile[]): DriveFile[] {
  return siblings
    .filter((f) => !isMediaTrack(f) && isSubtitleFile(f.name) && isNameMatched(mediaName, f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/** 同目录 .lrc：仅保留与音频文件名匹配的 */
export function listLyricFiles(mediaName: string, siblings: DriveFile[]): DriveFile[] {
  return siblings
    .filter((f) => !isMediaTrack(f) && isLyricFile(f.name) && isNameMatched(mediaName, f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/** 优先推荐与媒体文件名匹配的字幕/歌词 id（完全同名 > 包含匹配中更长主名） */
export function preferredSubtitleId(mediaName: string, files: DriveFile[]): string | null {
  if (!files.length) return null;
  const stem = mediaStem(mediaName);
  const exact = files.find((f) => mediaStem(f.name) === stem);
  if (exact) return exact.id;
  // 包含匹配：主名越长越优先
  const sorted = [...files].sort(
    (a, b) => mediaStem(b.name).length - mediaStem(a.name).length,
  );
  return sorted[0]?.id || null;
}

export function subtitleLabel(name: string): string {
  // 显示短文件名，避免下拉太长
  if (name.length <= 28) return name;
  const ext = name.match(/\.(srt|vtt|ass|ssa|lrc|txt)$/i)?.[0] || "";
  const stem = name.slice(0, name.length - ext.length);
  return `${stem.slice(0, 18)}…${ext}`;
}

function parseTimestamp(t: string): number | null {
  // 00:00:01.000 / 00:00:01,000 / 0:00:01.00
  const m = t.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.:](\d{1,3})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4].padEnd(3, "0").slice(0, 3));
  if (![h, mm, ss, ms].every((n) => Number.isFinite(n))) return null;
  return h * 3600 + mm * 60 + ss + ms / 1000;
}

/** ASS 时间 h:mm:ss.cc（百分秒） */
function parseAssTimestamp(t: string): number | null {
  const m = t.trim().match(/^(\d+):(\d{2}):(\d{2})[.:](\d{1,3})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const frac = m[4];
  // 2 位按百分秒，3 位按毫秒
  const ms = frac.length <= 2 ? Number(frac.padEnd(2, "0")) * 10 : Number(frac.padEnd(3, "0").slice(0, 3));
  if (![h, mm, ss, ms].every((n) => Number.isFinite(n))) return null;
  return h * 3600 + mm * 60 + ss + ms / 1000;
}

export function parseSrt(srt: string): Cue[] {
  const text = srt.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const blocks = text.split(/\n\s*\n/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1;
    const timeLine = lines[i];
    if (!timeLine || !timeLine.includes("-->")) continue;
    const [a, b] = timeLine.split("-->").map((s) => s.trim());
    const start = parseTimestamp(a.split(" ")[0] || "");
    const end = parseTimestamp(b.split(" ")[0] || "");
    if (start == null || end == null || end <= start) continue;
    const body = lines
      .slice(i + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}

export function parseVtt(vtt: string): Cue[] {
  let text = vtt.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/^WEBVTT[^\n]*\n/i, "");
  // 去掉 NOTE / STYLE 块（简单处理）
  text = text.replace(/^(NOTE|STYLE)[\s\S]*?(?=\n\n|\n\d|\n\d{2}:)/gim, "");
  return parseSrt(text);
}

export function parseAss(ass: string): Cue[] {
  const text = ass.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const cues: Cue[] = [];

  for (const line of text.split("\n")) {
    if (!/^Dialogue:/i.test(line)) continue;
    const rest = line.replace(/^Dialogue:\s*/i, "");
    // 按逗号拆，但 Text 里可能有逗号：前 9 段固定
    const parts = rest.split(",");
    if (parts.length < 10) continue;
    const start = parseAssTimestamp(parts[1]?.trim() || "");
    const end = parseAssTimestamp(parts[2]?.trim() || "");
    if (start == null || end == null || end <= start) continue;
    let body = parts.slice(9).join(",");
    body = body
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[nN]/g, "\n")
      .replace(/\\h/g, " ")
      .replace(/\\[a-zA-Z]+\d*/g, "")
      .trim();
    if (!body) continue;
    cues.push({ start, end, text: body });
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** LRC: [mm:ss.xx]歌词  或 [mm:ss.xxx] */
export function parseLrc(lrc: string): Cue[] {
  const text = lrc.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const raw: Array<{ start: number; text: string }> = [];

  for (const line of text.split("\n")) {
    const tags = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const body = line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "").trim();
    // 跳过元数据行 [ti:] [ar:] 等
    if (!body && /\[(ti|ar|al|by|offset):/i.test(line)) continue;
    if (!body) continue;
    for (const m of tags) {
      const mm = Number(m[1]);
      const ss = Number(m[2]);
      const frac = m[3] || "0";
      const ms = frac.length <= 2 ? Number(frac.padEnd(2, "0")) * 10 : Number(frac.padEnd(3, "0").slice(0, 3));
      const start = mm * 60 + ss + ms / 1000;
      if (!Number.isFinite(start)) continue;
      raw.push({ start, text: body });
    }
  }

  raw.sort((a, b) => a.start - b.start);
  const cues: Cue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const start = raw[i].start;
    const end = i + 1 < raw.length ? raw[i + 1].start : start + 8;
    cues.push({ start, end: Math.max(end, start + 0.2), text: raw[i].text });
  }
  return cues;
}

export function parseSubtitle(filename: string, content: string): Cue[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".lrc")) return parseLrc(content);
  if (lower.endsWith(".vtt") || /^WEBVTT/i.test(content.trim())) return parseVtt(content);
  if (lower.endsWith(".ass") || lower.endsWith(".ssa")) return parseAss(content);
  if (lower.endsWith(".srt")) return parseSrt(content);
  return parseSrt(content);
}

export function cueAt(cues: Cue[], time: number): string {
  // 简单线性扫描；字幕/歌词量通常不大
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (time >= c.start && time < c.end) return c.text;
  }
  return "";
}

/** 当前句 + 上下文（歌词滚动用） */
export function lyricWindow(
  cues: Cue[],
  time: number,
  around = 2,
): { lines: Array<{ text: string; active: boolean; idx: number }>; activeIdx: number } {
  if (!cues.length) return { lines: [], activeIdx: -1 };
  let activeIdx = -1;
  for (let i = 0; i < cues.length; i++) {
    if (time >= cues[i].start && time < cues[i].end) {
      activeIdx = i;
      break;
    }
    if (time >= cues[i].start) activeIdx = i;
  }
  if (activeIdx < 0) activeIdx = 0;
  const from = Math.max(0, activeIdx - around);
  const to = Math.min(cues.length - 1, activeIdx + around);
  const lines: Array<{ text: string; active: boolean; idx: number }> = [];
  for (let i = from; i <= to; i++) {
    lines.push({ text: cues[i].text, active: i === activeIdx, idx: i });
  }
  return { lines, activeIdx };
}
