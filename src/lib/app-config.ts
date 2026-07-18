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
  /** 改密后递增，用于使旧 session 失效 */
  passwordVersion: string;
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
  passwordVersion: "0",
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

function atomicWriteJson(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

/** 配置文件存在但无法解析（损坏） */
export function isConfigCorrupt(): boolean {
  const p = configPath();
  if (!fs.existsSync(p)) return false;
  try {
    const text = fs.readFileSync(p, "utf8");
    if (!text.trim()) return true;
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

/**
 * 是否允许首次初始化。
 * - 无配置文件：允许
 * - 配置损坏：禁止（避免被夺权）
 * - 已 setup 或已有账号哈希：禁止
 */
export function canRunSetup(): { ok: boolean; reason?: string; code?: string } {
  if (isConfigCorrupt()) {
    return {
      ok: false,
      code: "CONFIG_CORRUPT",
      reason:
        "配置文件损坏，已禁止重新初始化。请修复 data/app-config.json 或从备份恢复后再启动。",
    };
  }
  const cfg = readAppConfig();
  if (cfg.setupCompleted) {
    return { ok: false, reason: "已完成初始化，请直接登录", code: "SETUP_DONE" };
  }
  // 防御标志丢失但已有账号：仍禁止 setup
  if (cfg.username && cfg.passwordHash) {
    return {
      ok: false,
      reason: "检测到已有管理员账号，请直接登录",
      code: "ACCOUNT_EXISTS",
    };
  }
  return { ok: true };
}

export function readAppConfig(): AppConfig {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
    const text = fs.readFileSync(p, "utf8");
    if (!text.trim()) {
      // 空文件视为损坏：对外表现为「已锁定未完成」态，禁止 setup 由 canRunSetup 处理
      return {
        ...DEFAULT_CONFIG,
        setupCompleted: true,
        username: "__corrupt__",
        passwordHash: "__corrupt__",
      };
    }
    const raw = JSON.parse(text) as Partial<AppConfig>;
    const merged: AppConfig = {
      ...DEFAULT_CONFIG,
      ...raw,
      autoPlay: typeof raw.autoPlay === "boolean" ? raw.autoPlay : DEFAULT_CONFIG.autoPlay,
      siteIcon: normalizeSiteIcon(raw.siteIcon ?? DEFAULT_CONFIG.siteIcon),
      passwordVersion:
        typeof raw.passwordVersion === "string" && raw.passwordVersion
          ? raw.passwordVersion
          : DEFAULT_CONFIG.passwordVersion,
    };
    // 有账号哈希但标志为 false 时，视为已初始化，防止误开 setup
    if (!merged.setupCompleted && merged.username && merged.passwordHash) {
      merged.setupCompleted = true;
    }
    return merged;
  } catch {
    // 损坏：返回「已锁定」占位，避免 setupCompleted=false 被利用
    return {
      ...DEFAULT_CONFIG,
      setupCompleted: true,
      username: "__corrupt__",
      passwordHash: "__corrupt__",
      siteTitle: "NotionPan",
    };
  }
}

export function writeAppConfig(next: Partial<AppConfig>): AppConfig {
  if (isConfigCorrupt()) {
    throw new Error(
      "配置文件损坏，拒绝写入。请修复 data/app-config.json 或从备份恢复。",
    );
  }
  const current = readAppConfig();
  // 占位损坏态不可被正常 merge 写回
  if (current.username === "__corrupt__") {
    throw new Error(
      "配置文件损坏，拒绝写入。请修复 data/app-config.json 或从备份恢复。",
    );
  }
  let passwordVersion = current.passwordVersion || "0";
  if (
    typeof next.passwordHash === "string" &&
    next.passwordHash &&
    next.passwordHash !== current.passwordHash
  ) {
    passwordVersion = String(Date.now());
  } else if (typeof next.passwordVersion === "string" && next.passwordVersion) {
    passwordVersion = next.passwordVersion;
  }

  const merged: AppConfig = {
    ...current,
    ...next,
    siteIcon: normalizeSiteIcon(
      next.siteIcon !== undefined ? next.siteIcon : current.siteIcon,
    ),
    autoPlay:
      typeof next.autoPlay === "boolean" ? next.autoPlay : current.autoPlay,
    passwordVersion,
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(configPath(), merged);
  return merged;
}

/** 当前密码版本（改密后递增） */
export function getPasswordVersion(cfg = readAppConfig()): string {
  return cfg.passwordVersion || "0";
}

export function publicAppConfig(cfg = readAppConfig()) {
  const corrupt = isConfigCorrupt() || cfg.username === "__corrupt__";
  return {
    setupCompleted: corrupt ? true : cfg.setupCompleted,
    siteTitle: corrupt ? "NotionPan" : cfg.siteTitle || "NotionPan",
    siteDescription: corrupt ? "" : cfg.siteDescription || "",
    autoPlay: cfg.autoPlay !== false,
    siteIcon: normalizeSiteIcon(cfg.siteIcon),
    username: !corrupt && cfg.setupCompleted ? cfg.username : "",
    configCorrupt: corrupt || undefined,
  };
}
