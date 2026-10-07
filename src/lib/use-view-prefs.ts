import { useCallback, useSyncExternalStore } from "react";
import { isSortDir, isSortKey, type SortDir, type SortKey } from "./drive-list";

export type ViewMode = "list" | "gallery";
export type ViewPrefs = { viewMode: ViewMode; sortKey: SortKey; sortDir: SortDir };

export const DEFAULT_VIEW_PREFS: ViewPrefs = { viewMode: "list", sortKey: "createdTime", sortDir: "desc" };

const KEYS = {
  viewMode: "notionpan-view",
  sortKey: "notionpan-sort-key",
  sortDir: "notionpan-sort-dir",
} as const;

/** 从 storage 读取，非法值回退默认（storage 不可用时也回退） */
export function readViewPrefs(storage: Pick<Storage, "getItem"> | null | undefined): ViewPrefs {
  try {
    const v = storage?.getItem(KEYS.viewMode);
    const k = storage?.getItem(KEYS.sortKey);
    const d = storage?.getItem(KEYS.sortDir);
    return {
      viewMode: v === "gallery" || v === "list" ? v : DEFAULT_VIEW_PREFS.viewMode,
      sortKey: isSortKey(k) ? k : DEFAULT_VIEW_PREFS.sortKey,
      sortDir: isSortDir(d) ? d : DEFAULT_VIEW_PREFS.sortDir,
    };
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

// ---- 模块级 store：useSyncExternalStore 需要稳定的快照引用 ----

const listeners = new Set<() => void>();
let cache: ViewPrefs | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function getSnapshot(): ViewPrefs {
  if (!cache) cache = readViewPrefs(storage());
  return cache;
}

const getServerSnapshot = () => DEFAULT_VIEW_PREFS;

function subscribe(cb: () => void) {
  listeners.add(cb);
  // 其它标签页修改时同步
  const onStorage = (e: StorageEvent) => {
    if (e.key && !Object.values(KEYS).includes(e.key as (typeof KEYS)[keyof typeof KEYS])) return;
    cache = null;
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function writeViewPrefs(patch: Partial<ViewPrefs>) {
  const next = { ...getSnapshot(), ...patch };
  const cur = getSnapshot();
  if (next.viewMode === cur.viewMode && next.sortKey === cur.sortKey && next.sortDir === cur.sortDir) return;
  cache = next;
  const s = storage();
  try {
    s?.setItem(KEYS.viewMode, next.viewMode);
    s?.setItem(KEYS.sortKey, next.sortKey);
    s?.setItem(KEYS.sortDir, next.sortDir);
  } catch {
    // 隐私模式 / 配额满：仅内存生效
  }
  for (const l of listeners) l();
}

/**
 * 列表视图 / 排序偏好，持久化到 localStorage。
 * 用 useSyncExternalStore 读取，不在 effect 里 setState；SSR / 水合按默认值渲染。
 */
export function useViewPrefs(): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const set = useCallback((patch: Partial<ViewPrefs>) => writeViewPrefs(patch), []);
  return [prefs, set];
}
