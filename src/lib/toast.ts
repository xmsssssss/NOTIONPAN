/**
 * 轻量全局 toast：模块级 store + 订阅，任意位置调用 toast(...) 即可，无需 Context。
 * 纯逻辑，可在 Node 中单测；渲染见 components/Toaster.tsx。
 */
export type ToastKind = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type Listener = () => void;

export type ToastStore = {
  getSnapshot: () => readonly ToastItem[];
  subscribe: (l: Listener) => () => void;
  push: (message: string, kind?: ToastKind, durationMs?: number) => number;
  dismiss: (id: number) => void;
  clear: () => void;
};

/** 同时最多显示的条数；超出时丢弃最早的 */
export const MAX_TOASTS = 4;

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 2500,
  info: 3500,
  // 错误停留更久，便于阅读
  error: 6000,
};

export function createToastStore(
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
  } = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): ToastStore {
  // 每次变更都生成新数组，满足 useSyncExternalStore 的快照不可变要求
  let items: readonly ToastItem[] = [];
  let nextId = 1;
  const listeners = new Set<Listener>();
  const handles = new Map<number, unknown>();

  const emit = () => {
    for (const l of listeners) l();
  };

  const dismiss = (id: number) => {
    const h = handles.get(id);
    if (h !== undefined) timers.clearTimeout(h);
    handles.delete(id);
    const next = items.filter((t) => t.id !== id);
    if (next.length === items.length) return;
    items = next;
    emit();
  };

  return {
    getSnapshot: () => items,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    push: (message, kind = "info", durationMs) => {
      const text = String(message || "").trim();
      if (!text) return 0;
      // 相同内容与类型已在显示：不重复堆叠，只重置计时
      const dup = items.find((t) => t.message === text && t.kind === kind);
      const id = dup ? dup.id : nextId++;
      if (!dup) {
        let next = [...items, { id, kind, message: text }];
        if (next.length > MAX_TOASTS) {
          for (const old of next.slice(0, next.length - MAX_TOASTS)) {
            const h = handles.get(old.id);
            if (h !== undefined) timers.clearTimeout(h);
            handles.delete(old.id);
          }
          next = next.slice(-MAX_TOASTS);
        }
        items = next;
        emit();
      }
      const prev = handles.get(id);
      if (prev !== undefined) timers.clearTimeout(prev);
      const ms = durationMs ?? DEFAULT_DURATION[kind];
      if (ms > 0) handles.set(id, timers.setTimeout(() => dismiss(id), ms));
      return id;
    },
    dismiss,
    clear: () => {
      for (const h of handles.values()) timers.clearTimeout(h);
      handles.clear();
      if (!items.length) return;
      items = [];
      emit();
    },
  };
}

/** 应用全局实例 */
export const toastStore = createToastStore();

export const toast = {
  success: (msg: string, ms?: number) => toastStore.push(msg, "success", ms),
  error: (msg: string, ms?: number) => toastStore.push(msg, "error", ms),
  info: (msg: string, ms?: number) => toastStore.push(msg, "info", ms),
};

/** 把 unknown 错误转成可读文案 */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  return fallback;
}
