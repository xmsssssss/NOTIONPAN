"use client";

import { useEffect, useState } from "react";
import {
  applyTheme,
  getSystemTheme,
  readStoredTheme,
  resolveTheme,
  toggleTheme,
  type ThemeMode,
} from "@/lib/theme";

function IconSun({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconMoon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5Z" />
    </svg>
  );
}

function useThemeState() {
  const [theme, setThemeState] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = resolveTheme(readStoredTheme());
    setThemeState(initial);
    applyTheme(initial);
    setReady(true);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStoredTheme()) return;
      const next = getSystemTheme();
      setThemeState(next);
      applyTheme(next);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const onToggle = () => setThemeState((cur) => toggleTheme(cur));
  return { theme, ready, onToggle, isDark: theme === "dark" };
}

/** 顶栏 / 登录 / 后台用的小按钮 */
export function ThemeToggle({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { ready, onToggle, isDark } = useThemeState();

  return (
    <button
      type="button"
      onClick={onToggle}
      title={isDark ? "切换到浅色模式" : "切换到深色模式"}
      aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
      className={
        className ||
        `flex shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] shadow-sm transition hover:border-sky-300 hover:text-sky-600 active:scale-95 ${
          compact ? "h-9 w-9" : "h-10 w-10"
        }`
      }
    >
      <span className={!ready ? "opacity-0" : "opacity-100 transition-opacity"}>
        {isDark ? <IconSun className="h-5 w-5" /> : <IconMoon className="h-5 w-5" />}
      </span>
    </button>
  );
}

/**
 * 主题小人（图片）
 * 浅色 = /theme/ram.png  深色 = /theme/rem.png
 */
export function ThemeChibi() {
  const { ready, onToggle, isDark } = useThemeState();
  const [bounce, setBounce] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setBounce(true);
    onToggle();
    window.setTimeout(() => setBounce(false), 380);
  };

  const src = isDark ? "/theme/rem.png" : "/theme/ram.png";
  const title = isDark ? "切换到浅色模式" : "切换到深色模式";

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={(e) => e.stopPropagation()}
      title={title}
      aria-label={title}
      className={`theme-chibi group pointer-events-auto relative z-30 select-none ${
        !ready ? "opacity-0" : "opacity-100"
      } ${bounce ? "theme-chibi-bounce" : ""}`}
    >
      <span className="theme-chibi-shadow" aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={118}
        height={102}
        draggable={false}
        className="theme-chibi-img h-[56px] w-auto max-w-[96px] object-contain drop-shadow-lg transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-95 sm:h-[64px]"
      />
      <span className="sr-only">{title}</span>
    </button>
  );
}
