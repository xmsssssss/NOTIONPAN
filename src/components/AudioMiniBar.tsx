"use client";

import type { DriveFile } from "@/lib/types";

/** 左下角迷你音乐条：展开 / 上曲 / 播放暂停 / 下曲 / 歌名 */
export function AudioMiniBar({
  file,
  playing,
  hasPrev,
  hasNext,
  onExpand,
  onTogglePlay,
  onPrev,
  onNext,
  onClose,
}: {
  file: DriveFile;
  playing: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onExpand: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div className="audio-mini-offset fixed z-50 flex max-w-[min(100vw-1.5rem,22rem)] items-center gap-1 rounded-2xl border border-slate-200/90 bg-white/95 px-2 py-1.5 shadow-xl shadow-slate-300/40 backdrop-blur-md sm:max-w-sm">
      <button
        type="button"
        onClick={onExpand}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-sky-500 to-teal-400 text-white shadow-md shadow-sky-500/25"
        title="展开播放器"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onPrev}
        disabled={!hasPrev}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30"
        title="上一曲"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onTogglePlay}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-teal-400 text-white shadow-md shadow-sky-500/30"
        title={playing ? "暂停" : "播放"}
      >
        {playing ? (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
          </svg>
        ) : (
          <svg className="ml-0.5 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30"
        title="下一曲"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 6h2v12h-2zM6 6l8.5 6L6 18V6z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onExpand}
        className="min-w-0 flex-1 px-1 text-left"
        title="展开播放器"
      >
        <span className="block truncate text-xs font-medium text-slate-800">{file.name}</span>
        <span className="block text-[10px] text-slate-400">{playing ? "播放中" : "已暂停"}</span>
      </button>

      <button
        type="button"
        onClick={onClose}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        title="关闭播放"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
