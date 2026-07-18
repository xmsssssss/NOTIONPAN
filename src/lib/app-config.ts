import fs from "fs";
import path from "path";

export type AppConfig = {
  username: string;
  passwordHash: string;
  siteTitle: string;
  siteDescription: string;
  /** 媒体预览是否自动播放 */
  autoPlay: boolean;
  /** 站点图标字母，1 个字符，默认 N */
  siteIcon: string;
  setupCompleted: boolean;
  updatedAt: string | null;
};

const DEFAULT_CONFIG: AppConfig = {
  username: "",
  passwordHash: "",
  siteTitle: "NotionPan",
  siteDescription: "Notion 存储 · 网盘体验",
  autoPlay: true,
  siteIcon: "N",
  setupCompleted: false,
  updatedAt: null,
};

function dataDir() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configPath() {
  return path.join(dataDir(), "app-config.json");
}

export function normalizeSiteIcon(raw?: string | null): string {
  const s = (raw || "").trim();
  if (!s) return "N";
  // 取第一个可见字符（支持中文/emoji 首字符）
  const ch = Array.from(s)[0] || "N";
  return ch.slice(0, 2);
}

export function readAppConfig(): AppConfig {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      autoPlay: typeof raw.autoPlay === "boolean" ? raw.autoPlay : DEFAULT_CONFIG.autoPlay,
      siteIcon: normalizeSiteIcon(raw.siteIcon ?? DEFAULT_CONFIG.siteIcon),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeAppConfig(next: Partial<AppConfig>): AppConfig {
  const current = readAppConfig();
  const merged: AppConfig = {
    ...current,
    ...next,
    siteIcon: normalizeSiteIcon(
      next.siteIcon !== undefined ? next.siteIcon : current.siteIcon,
    ),
    autoPlay:
      typeof next.autoPlay === "boolean" ? next.autoPlay : current.autoPlay,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

export function publicAppConfig(cfg = readAppConfig()) {
  return {
    setupCompleted: cfg.setupCompleted,
    siteTitle: cfg.siteTitle || "NotionPan",
    siteDescription: cfg.siteDescription || "",
    autoPlay: cfg.autoPlay !== false,
    siteIcon: normalizeSiteIcon(cfg.siteIcon),
    username: cfg.setupCompleted ? cfg.username : "",
  };
}
