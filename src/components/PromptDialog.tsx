"use client";

import { useEffect, useRef, useState } from "react";
import { IconClose } from "./icons";

export function PromptDialog({
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
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await onConfirm(v);
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-5 shadow-2xl shadow-slate-300/50">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
            {label && <p className="mt-1 text-xs text-[var(--muted)]">{label}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--panel-2)]"
          >
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={!value.trim() || busy}
            className="rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-2 text-sm font-medium text-white shadow-md shadow-sky-200 disabled:opacity-50"
          >
            {busy ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
