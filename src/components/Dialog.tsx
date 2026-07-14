"use client";

import { useEffect, useRef } from "react";
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-900/55 via-slate-800/45 to-slate-900/55 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`relative z-10 w-full overflow-hidden rounded-3xl border border-white/30 bg-white shadow-2xl ${
          wide ? "max-w-lg" : "max-w-md"
        }`}
        style={{
          boxShadow: "0 25px 80px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(255,255,255,0.35) inset",
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-white via-slate-50 to-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
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
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium text-white shadow-lg transition disabled:opacity-50 ${
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
    >
      {children}
    </button>
  );
}
