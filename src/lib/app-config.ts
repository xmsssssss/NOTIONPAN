import fs from "fs";
import path from "path";

export type AppConfig = {
  username: string;
  passwordHash: string;
  siteTitle: string;
  siteDescription: string;
  setupCompleted: boolean;
  updatedAt: string | null;
};

const DEFAULT_CONFIG: AppConfig = {
  username: "",
  passwordHash: "",
  siteTitle: "NotionPan",
  siteDescription: "Notion 存储 · 网盘体验",
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

export function readAppConfig(): AppConfig {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AppConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeAppConfig(next: Partial<AppConfig>): AppConfig {
  const current = readAppConfig();
  const merged: AppConfig = {
    ...current,
    ...next,
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
    username: cfg.setupCompleted ? cfg.username : "",
  };
}
