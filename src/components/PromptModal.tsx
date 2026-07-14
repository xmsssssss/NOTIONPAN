"use client";

import { useEffect, useRef, useState } from "react";
import { IconClose } from "./icons";

export function PromptModal({
  title,
  label,
  defaultValue = "",
  placeholder,
  confirmText = "确定",
  onConfirm,
  onClose,
}: {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#1a2744]/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_20px_60px_rgba(26,39,68,0.16)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {label && <p className="mt-1 text-xs text-[var(--muted)]">{label}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="mb-4 w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:bg-white"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-white px-3.5 py-2 text-sm hover:bg-[var(--panel-2)]"
          >
            取消
          </button>
          <button
            onClick={submit}
            className="rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-3.5 py-2 text-sm font-medium text-white shadow-md shadow-blue-500/20 hover:opacity-95"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
