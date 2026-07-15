"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
};

export function ContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [mobile, setMobile] = useState(false);

  useLayoutEffect(() => {
    const isMobile = window.innerWidth < 640;
    setMobile(isMobile);
    if (isMobile) return;

    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    setPos({ left, top });
  }, [x, y, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = "touches" in e ? e.target : (e as MouseEvent).target;
      if (ref.current && !ref.current.contains(target as Node)) onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const menuBody = items.map((item, i) =>
    item.separator ? (
      <div key={`sep-${i}`} className="my-1 h-px bg-[var(--border)]" />
    ) : (
      <button
        key={item.id}
        role="menuitem"
        disabled={item.disabled}
        onClick={() => {
          if (item.disabled) return;
          onSelect(item.id);
          onClose();
        }}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2.5 sm:px-3 sm:py-2.5 ${
          item.danger
            ? "text-[var(--danger)] hover:bg-red-50"
            : "text-[var(--text)] hover:bg-[var(--panel-2)]"
        }`}
      >
        {item.icon && <span className="opacity-80">{item.icon}</span>}
        <span>{item.label}</span>
      </button>
    ),
  );

  // 手机：底部操作表
  if (mobile) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col justify-end">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
        <div
          ref={ref}
          className="safe-bottom relative z-10 max-h-[75vh] overflow-auto rounded-t-3xl border border-slate-200 bg-white shadow-2xl"
          role="menu"
        >
          <div className="flex justify-center py-2">
            <div className="h-1 w-10 rounded-full bg-slate-200" />
          </div>
          <div className="px-1 pb-2">{menuBody}</div>
          <button
            type="button"
            onClick={onClose}
            className="mx-3 mb-2 w-[calc(100%-1.5rem)] rounded-xl border border-slate-200 bg-slate-50 py-3 text-sm font-medium text-slate-600"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="context-menu fixed z-[100] min-w-[180px] overflow-hidden rounded-xl border border-[var(--border)] bg-white/95 py-1 shadow-xl shadow-slate-300/50 backdrop-blur-md"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      {menuBody}
    </div>
  );
}
