"use client";

import { useEffect, useId, useRef } from "react";
import { getFocusable, nextTrapIndex } from "@/lib/focus-trap";
import { IconClose } from "./icons";

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // 调用方多传内联箭头函数：用 ref 持有最新 onClose，避免 effect 每次渲染重跑抢焦点
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // 记住打开前的焦点，关闭后归还
    const opener = document.activeElement as HTMLElement | null;

    // 初始焦点：子元素 autoFocus 已生效则保留，否则聚焦首个可聚焦元素或面板本身
    if (panel && !panel.contains(document.activeElement)) {
      const first = getFocusable(panel)[0];
      (first ?? panel).focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = getFocusable(panel);
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const next = nextTrapIndex(items.length, idx, e.shiftKey);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
      } else if (next !== null) {
        e.preventDefault();
        items[next].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected && typeof opener.focus === "function") {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-slate-900/55 via-slate-800/45 to-slate-900/55 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`safe-bottom relative z-10 flex outline-none max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/30 bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-3xl ${
          wide ? "sm:max-w-lg" : "sm:max-w-md"
        }`}
        style={{
          boxShadow: "0 25px 80px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(255,255,255,0.35) inset",
        }}
      >
        <div className="flex justify-center pt-2 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-white via-slate-50 to-white px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-800">{title}</h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-slate-500">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            {children}
          </div>
        )}
        {footer && (
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function DialogInput({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-medium text-slate-700">{label}</span>}
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
      />
    </label>
  );
}

export function BtnPrimary({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg transition disabled:opacity-50 sm:w-auto sm:py-2 ${
        danger
          ? "bg-gradient-to-r from-red-500 to-rose-500 shadow-red-500/20 hover:brightness-105"
          : "bg-gradient-to-r from-blue-500 to-teal-400 shadow-blue-500/20 hover:brightness-105"
      }`}
    >
      {children}
    </button>
  );
}

export function BtnGhost({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 sm:w-auto sm:py-2"
    >
      {children}
    </button>
  );
}
