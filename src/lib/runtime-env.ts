import fs from "fs";
import path from "path";

const ENV_KEYS = [
  "NOTION_API_KEY",
  "NOTION_DATABASE_ID",
  "NOTION_DATA_SOURCE_ID",
  "SESSION_SECRET",
  "COOKIE_SECURE",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

let overrides: Record<string, string> = {};
let loaded = false;

function dataDir() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 环境文件路径：
 * - ENV_FILE 优先
 * - Docker / DATA_DIR：写入 data/.env.local（随 volume 持久化）
 * - 本地开发：优先已有 .env.local，否则 data/.env.local 或项目根
 */
function envFilePath() {
  if (process.env.ENV_FILE) return process.env.ENV_FILE;

  const inData = path.join(dataDir(), ".env.local");
  const inRoot = path.join(process.cwd(), ".env.local");

  // 已有 data 内配置（Docker 常见）
  if (fs.existsSync(inData)) return inData;
  // 本地根目录 .env.local
  if (fs.existsSync(inRoot) && process.env.DOCKER !== "1" && !process.env.DATA_DIR) {
    return inRoot;
  }
  // Docker 默认写到 volume
  if (process.env.DOCKER === "1" || process.env.DATA_DIR) {
    return inData;
  }
  return inRoot;
}

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function serializeEnv(map: Record<string, string>): string {
  const lines = [
    "# NotionPan runtime env",
    `# updated: ${new Date().toISOString()}`,
    "",
  ];
  for (const key of ENV_KEYS) {
    if (map[key] != null && map[key] !== "") {
      lines.push(`${key}=${map[key]}`);
    }
  }
  // keep unknown keys from existing map if any
  for (const [k, v] of Object.entries(map)) {
    if ((ENV_KEYS as readonly string[]).includes(k)) continue;
    if (v) lines.push(`${k}=${v}`);
  }
  return lines.join("\n") + "\n";
}

export function ensureRuntimeEnvLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const p = envFilePath();
    if (fs.existsSync(p)) {
      overrides = parseEnvText(fs.readFileSync(p, "utf8"));
      for (const [k, v] of Object.entries(overrides)) {
        if (v) process.env[k] = v;
      }
    }
  } catch {
    // ignore
  }
}

export function getRuntimeEnv(name: string): string | undefined {
  ensureRuntimeEnvLoaded();
  if (overrides[name] != null && overrides[name] !== "") return overrides[name];
  return process.env[name];
}

export function getRuntimeEnvRequired(name: string): string {
  const v = getRuntimeEnv(name);
  if (!v) throw new Error(`缺少环境变量 ${name}，请在后台或 .env.local 中配置`);
  return v;
}

export function readEnvConfig(): {
  values: Record<string, string>;
  masked: Record<string, string>;
} {
  ensureRuntimeEnvLoaded();
  const values: Record<string, string> = {};
  const masked: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const v = getRuntimeEnv(key) || "";
    values[key] = v;
    if (!v) masked[key] = "";
    else if (key === "NOTION_API_KEY" || key === "SESSION_SECRET") {
      masked[key] = v.length <= 8 ? "****" : `${v.slice(0, 4)}****${v.slice(-4)}`;
    } else {
      masked[key] = v;
    }
  }
  return { values, masked };
}

export function writeEnvConfig(input: Record<string, string>): {
  saved: string[];
} {
  ensureRuntimeEnvLoaded();
  const p = envFilePath();
  let current: Record<string, string> = {};
  if (fs.existsSync(p)) {
    current = parseEnvText(fs.readFileSync(p, "utf8"));
  }

  const saved: string[] = [];
  for (const key of ENV_KEYS) {
    if (!(key in input)) continue;
    const val = String(input[key] ?? "").trim();
    // empty means keep old for secrets if already set
    if (!val) {
      if (key === "NOTION_API_KEY" || key === "SESSION_SECRET") continue;
      delete current[key];
      delete overrides[key];
      delete process.env[key];
      saved.push(key);
      continue;
    }
    // ignore unchanged masked placeholders
    if (val.includes("****")) continue;
    current[key] = val;
    overrides[key] = val;
    process.env[key] = val;
    saved.push(key);
  }

  fs.writeFileSync(p, serializeEnv(current), "utf8");
  loaded = true;
  return { saved };
}

export function softReloadEnv(): { keys: string[] } {
  loaded = false;
  overrides = {};
  ensureRuntimeEnvLoaded();
  return { keys: Object.keys(overrides) };
}

export { ENV_KEYS };
