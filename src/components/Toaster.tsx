"use client";

import { useSyncExternalStore } from "react";
import { toastStore, type ToastKind } from "@/lib/toast";
import { IconClose } from "./icons";

const EMPTY: readonly never[] = [];

const KIND_STYLE: Record<ToastKind, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-700",
  info: "border-slate-200 bg-white text-slate-700",
};

/**
 * 全局提示条容器，挂一次即可。z-index 高于 Dialog（z-80）与预览层，
 * 保证弹窗打开时报错也可见。
 * 错误用 role="alert"（立即播报），其它用 role="status"（礼貌播报）。
 */
export function Toaster() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, () => EMPTY);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[120] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          aria-live={t.kind === "error" ? "assertive" : "polite"}
          className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-lg ${KIND_STYLE[t.kind]}`}
        >
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => toastStore.dismiss(t.id)}
            className="shrink-0 rounded-md p-0.5 opacity-60 transition hover:opacity-100"
            aria-label="关闭提示"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
