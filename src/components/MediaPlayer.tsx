"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DriveFile } from "@/lib/types";
import {
  cueAt,
  lyricWindow,
  parseSubtitle,
  preferredSubtitleId,
  subtitleLabel,
  type Cue,
} from "@/lib/subtitle";
import { formatBytes } from "@/lib/utils";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type SubOption = {
  id: string;
  label: string;
  name: string;
};

/** once 播完停 | loop 单曲循环 | list 列表循环 */
export type PlayMode = "once" | "loop" | "list";

const PLAY_MODE_CYCLE: PlayMode[] = ["once", "loop", "list"];

const PLAY_MODE_META: Record<PlayMode, { label: string; title: string }> = {
  once: { label: "单曲", title: "单曲播放（播完停止）" },
  loop: { label: "循环", title: "单曲循环" },
  list: { label: "列表", title: "列表循环" },
};

export function MediaPlayer({
  src,
  kind,
  title,
  size,
  subtitleFiles = [],
  autoPlay = true,
  /** 为 true 时不渲染 audio 元素（由上层常驻 audio 负责发声） */
  externalMedia = false,
  /** 外部 audio 元素，用于同步进度/播放状态 */
  externalAudioEl = null,
  playMode = "once",
  onPlayModeChange,
  onEnded,
}: {
  src: string;
  kind: "audio" | "video";
  title: string;
  size?: number;
  /** 同目录字幕/歌词列表（用户可下拉选择） */
  subtitleFiles?: DriveFile[];
  autoPlay?: boolean;
  externalMedia?: boolean;
  externalAudioEl?: HTMLAudioElement | null;
  playMode?: PlayMode;
  onPlayModeChange?: (mode: PlayMode) => void;
  /** 单曲播完且非 loop 时通知上层（列表循环切换下一首） */
  onEnded?: () => void;
}) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lyricScrollRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
  const cueCache = useRef<Map<string, Cue[]>>(new Map());
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [hover, setHover] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string>("off");
  const [cues, setCues] = useState<Cue[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [bars] = useState(() =>
    Array.from({ length: 28 }, () => 0.25 + Math.random() * 0.75),
  );

  const subKey = subtitleFiles.map((f) => f.id).join(",");

  const subOptions: SubOption[] = useMemo(
    () =>
      subtitleFiles.map((f) => ({
        id: f.id,
        label: subtitleLabel(f.name),
        name: f.name,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subKey],
  );

  const setMediaRef = useCallback((node: HTMLVideoElement | HTMLAudioElement | null) => {
    mediaRef.current = node;
  }, []);

  // 绑定外部 audio：进度与播放状态同步到 UI
  useEffect(() => {
    if (!externalMedia || !externalAudioEl) return;
    mediaRef.current = externalAudioEl;
    const el = externalAudioEl;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(el.currentTime || 0);
    const onMeta = () => setDuration(el.duration || 0);
    const onWait = () => setBuffering(true);
    const onCan = () => setBuffering(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("waiting", onWait);
    el.addEventListener("playing", onCan);
    el.addEventListener("canplay", onCan);
    setPlaying(!el.paused);
    setCurrent(el.currentTime || 0);
    setDuration(el.duration || 0);
    setBuffering(el.readyState < 3 && !el.paused);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("waiting", onWait);
      el.removeEventListener("playing", onCan);
      el.removeEventListener("canplay", onCan);
    };
  }, [externalMedia, externalAudioEl, src]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.volume = muted ? 0 : volume;
  }, [volume, muted, externalMedia, externalAudioEl]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.playbackRate = rate;
  }, [rate, externalMedia, externalAudioEl]);

  // 曲目/标题变化时：按文件名重新匹配歌词/字幕（必须重置，不能沿用上一曲的 activeSub）
  useEffect(() => {
    if (kind !== "video" && kind !== "audio") {
      setActiveSub("off");
      setCues([]);
      return;
    }
    if (!subtitleFiles.length) {
      setActiveSub("off");
      setCues([]);
      return;
    }
    const pref = preferredSubtitleId(title, subtitleFiles) || subtitleFiles[0]?.id || "off";
    setActiveSub(pref);
    setCues([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, title, subKey]);

  // 按需加载并解析选中字幕/歌词
  useEffect(() => {
    if ((kind !== "video" && kind !== "audio") || activeSub === "off") {
      setCues([]);
      setSubLoading(false);
      return;
    }

    const file = subtitleFiles.find((f) => f.id === activeSub);
    if (!file) {
      setCues([]);
      setSubLoading(false);
      return;
    }

    const cached = cueCache.current.get(file.id);
    if (cached) {
      setCues(cached);
      setSubLoading(false);
      return;
    }

    let cancelled = false;
    setSubLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/files/${file.id}/download?proxy=1`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`字幕加载失败 ${res.status}`);
        const raw = await res.text();
        const parsed = parseSubtitle(file.name, raw);
        cueCache.current.set(file.id, parsed);
        if (!cancelled) setCues(parsed);
      } catch {
        if (!cancelled) setCues([]);
      } finally {
        if (!cancelled) setSubLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, activeSub, subKey, title]);

  const subtitleText = useMemo(() => {
    if (kind !== "video" || activeSub === "off" || !cues.length) return "";
    return cueAt(cues, current);
  }, [kind, activeSub, cues, current]);

  const activeLyricIdx = useMemo(() => {
    if (kind !== "audio" || activeSub === "off" || !cues.length) return -1;
    return lyricWindow(cues, current, 0).activeIdx;
  }, [kind, activeSub, cues, current]);

  // 当前句变化时，滚到可视区域正中间
  useEffect(() => {
    if (kind !== "audio" || activeLyricIdx < 0) return;
    const box = lyricScrollRef.current;
    const el = activeLyricRef.current;
    if (!box || !el) return;

    // 相对滚动容器的偏移（不依赖 offsetParent）
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const elTopInBox = elRect.top - boxRect.top + box.scrollTop;
    const target = elTopInBox - box.clientHeight / 2 + elRect.height / 2;
    box.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [kind, activeLyricIdx, activeSub, cues.length]);

  const togglePlay = async () => {
    const el = mediaRef.current;
    if (!el) return;
    try {
      if (el.paused) {
        await el.play();
        setPlaying(true);
      } else {
        el.pause();
        setPlaying(false);
      }
    } catch {
      setError("播放失败，请尝试下载后本地打开");
    }
  };

  const seekFromEvent = (clientX: number) => {
    const el = mediaRef.current;
    const bar = barRef.current;
    if (!el || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrent(el.currentTime);
  };

  const toggleFullscreen = async () => {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.requestFullscreen();
    } catch {
      // ignore
    }
  };

  const handleEnded = () => {
    // 外部 audio 时由上层 onEnded 处理 loop/list
    if (externalMedia) {
      onEnded?.();
      return;
    }
    const mode = playModeRef.current;
    const el = mediaRef.current;
    if (mode === "loop") {
      if (el) {
        el.currentTime = 0;
        void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
      return;
    }
    setPlaying(false);
    if (mode === "list") {
      onEnded?.();
    }
  };

  const cyclePlayMode = () => {
    if (!onPlayModeChange) return;
    const i = PLAY_MODE_CYCLE.indexOf(playMode);
    const next = PLAY_MODE_CYCLE[(i + 1) % PLAY_MODE_CYCLE.length];
    onPlayModeChange(next);
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={
        kind === "video"
          ? "relative flex h-full min-h-0 w-full max-w-none flex-1 items-center justify-center overflow-hidden sm:max-w-3xl"
          : "relative mx-auto w-full max-w-md overflow-hidden"
      }
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onTouchStart={() => setHover(true)}
    >
      {kind === "video" ? (
        <div className="relative h-full min-h-0 w-full overflow-hidden bg-black sm:aspect-video sm:h-auto sm:max-h-full sm:rounded-lg sm:shadow-lg sm:ring-1 sm:ring-slate-200">
          <video
            ref={setMediaRef as React.RefCallback<HTMLVideoElement>}
            src={src}
            className="absolute inset-0 h-full w-full bg-black object-contain"
            playsInline
            onClick={() => void togglePlay()}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime || 0)}
            onError={() => setError("视频加载失败（格式可能不被浏览器支持）")}
            autoPlay={autoPlay}
          />
          {buffering && !error && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </div>
          )}
          {!playing && !error && !buffering && (
            <button
              onClick={() => void togglePlay()}
              className="absolute inset-0 z-[5] flex items-center justify-center bg-black/20"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-xl transition active:scale-95 sm:h-16 sm:w-16 hover:scale-105">
                <svg className="ml-1 h-7 w-7 sm:h-7 sm:w-7" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>
          )}
          {/* 字幕贴在控制条上方，播放时更靠下、显示控制条时上移避免遮挡 */}
          {subtitleText && (
            <div
              className={`np-sub-layer pointer-events-none absolute inset-x-0 z-10 flex justify-center px-3 transition-[bottom] duration-200 sm:px-6 ${
                hover || !playing
                  ? "bottom-[5.5rem] sm:bottom-[4.25rem]"
                  : "bottom-8 sm:bottom-6"
              }`}
            >
              <div className="np-sub-text max-w-[min(92%,42rem)] whitespace-pre-line text-center text-[15px] font-medium leading-snug sm:text-[16px] md:text-[17px]">
                {subtitleText}
              </div>
            </div>
          )}
          <div
            className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-14 transition sm:px-4 sm:pb-3 sm:pt-10 ${
              hover || !playing ? "opacity-100" : "opacity-100 sm:opacity-0"
            }`}
          >
            <Controls
              kind={kind}
              playing={playing}
              current={current}
              duration={duration}
              progress={progress}
              volume={volume}
              muted={muted}
              rate={rate}
              barRef={barRef}
              subOptions={subOptions}
              activeSub={activeSub}
              subLoading={subLoading}
              onSubChange={setActiveSub}
              trackLabel="字幕"
              onTogglePlay={() => void togglePlay()}
              onSeek={seekFromEvent}
              onVolume={(v) => {
                setVolume(v);
                setMuted(v === 0);
              }}
              onMute={() => setMuted((m) => !m)}
              onRate={() => setRate((r) => (r === 1 ? 1.25 : r === 1.25 ? 1.5 : r === 1.5 ? 2 : 1))}
              onFullscreen={() => void toggleFullscreen()}
            />
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="relative px-3 pb-3 pt-4 sm:px-4 sm:pb-4 sm:pt-5">
              <div className="mb-3 flex flex-col items-center text-center sm:mb-4">
                <div className="relative mb-3">
                  <div
                    className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-sky-500 to-teal-400 text-white shadow-lg shadow-sky-500/25 sm:h-20 sm:w-20 ${
                      playing ? "animate-pulse" : ""
                    }`}
                  >
                    <svg className="h-7 w-7 sm:h-9 sm:w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                  {playing && (
                    <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-end gap-0.5">
                      {bars.map((h, i) => (
                        <span
                          key={i}
                          className="np-eq w-1 origin-bottom rounded-full bg-sky-500/80"
                          style={{
                            height: `${6 + h * 10}px`,
                            animationDelay: `${i * 0.04}s`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <h3 className="max-w-full truncate px-2 text-base font-semibold text-slate-800">{title}</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  音频 · {size != null ? formatBytes(size) : "—"}
                </p>
              </div>

              {/* 歌词区：固定高度，可滚动，当前句居中 */}
              {kind === "audio" && (
                <div className="mb-3 h-40 overflow-hidden rounded-xl border border-sky-100 bg-gradient-to-b from-sky-50/80 to-white sm:h-44">
                  {subLoading ? (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      歌词加载中…
                    </div>
                  ) : !subOptions.length ? (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      未匹配到歌词文件
                    </div>
                  ) : !cues.length ? (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      未匹配到歌词内容
                    </div>
                  ) : (
                    <div
                      ref={lyricScrollRef}
                      className="np-lyric-scroll h-full overflow-y-auto overscroll-contain px-3 sm:px-4"
                    >
                      {/* 上下垫高，保证首尾句也能滚到中间 */}
                      <div className="flex flex-col items-center gap-3" style={{ paddingTop: "4.5rem", paddingBottom: "4.5rem" }}>
                        {cues.map((line, idx) => {
                          const active = idx === activeLyricIdx;
                          return (
                            <p
                              key={`${idx}-${line.start}`}
                              ref={active ? activeLyricRef : undefined}
                              data-lyric-idx={idx}
                              className={`w-full cursor-pointer select-none text-center transition-all duration-200 ${
                                active
                                  ? "text-sm font-semibold text-sky-700 sm:text-base"
                                  : "text-xs text-slate-400 sm:text-[13px]"
                              }`}
                              onClick={() => {
                                const el = mediaRef.current;
                                if (!el) return;
                                el.currentTime = Math.max(0, line.start);
                                setCurrent(line.start);
                              }}
                              title="点击跳转到此句"
                            >
                              {line.text}
                            </p>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!externalMedia && (
                <audio
                  ref={setMediaRef as React.RefCallback<HTMLAudioElement>}
                  src={src}
                  className="hidden"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onWaiting={() => setBuffering(true)}
                  onPlaying={() => setBuffering(false)}
                  onCanPlay={() => setBuffering(false)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                  onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime || 0)}
                  onEnded={handleEnded}
                  onError={() => setError("音频加载失败")}
                  autoPlay={autoPlay}
                  loop={playMode === "loop"}
                />
              )}

              <div className="rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5 shadow-inner">
                <Controls
                  kind={kind}
                  playing={playing}
                  current={current}
                  duration={duration}
                  progress={progress}
                  volume={volume}
                  muted={muted}
                  rate={rate}
                  barRef={barRef}
                  playMode={playMode}
                  onPlayMode={onPlayModeChange ? cyclePlayMode : undefined}
                  subOptions={subOptions}
                  activeSub={activeSub}
                  subLoading={subLoading}
                  onSubChange={setActiveSub}
                  trackLabel="歌词"
                  light
                  buffering={buffering}
                  onTogglePlay={() => void togglePlay()}
                  onSeek={seekFromEvent}
                  onVolume={(v) => {
                    setVolume(v);
                    setMuted(v === 0);
                  }}
                  onMute={() => setMuted((m) => !m)}
                  onRate={() => setRate((r) => (r === 1 ? 1.25 : r === 1.25 ? 1.5 : r === 1.5 ? 2 : 1))}
                />
              </div>
            </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

function Controls({
  kind,
  playing,
  current,
  duration,
  progress,
  volume,
  muted,
  rate,
  barRef,
  light,
  buffering,
  playMode = "once",
  onPlayMode,
  subOptions = [],
  activeSub = "off",
  subLoading,
  trackLabel = "字幕",
  onSubChange,
  onTogglePlay,
  onSeek,
  onVolume,
  onMute,
  onRate,
  onFullscreen,
}: {
  kind: "audio" | "video";
  playing: boolean;
  current: number;
  duration: number;
  progress: number;
  volume: number;
  muted: boolean;
  rate: number;
  barRef: React.RefObject<HTMLDivElement | null>;
  light?: boolean;
  buffering?: boolean;
  playMode?: PlayMode;
  onPlayMode?: () => void;
  subOptions?: SubOption[];
  activeSub?: string;
  subLoading?: boolean;
  trackLabel?: string;
  onSubChange?: (id: string) => void;
  onTogglePlay: () => void;
  onSeek: (clientX: number) => void;
  onVolume: (v: number) => void;
  onMute: () => void;
  onRate: () => void;
  onFullscreen?: () => void;
}) {
  const text = light ? "text-slate-700" : "text-white";
  const mutedText = light ? "text-slate-500" : "text-white/70";
  const track = light ? "bg-slate-200" : "bg-white/25";
  const fill = light
    ? "bg-gradient-to-r from-sky-500 to-teal-400"
    : "bg-gradient-to-r from-sky-400 to-teal-300";

  return (
    <div className={`space-y-2 ${text}`}>
      <div
        ref={barRef}
        className={`group relative h-2 cursor-pointer rounded-full sm:h-1.5 ${track}`}
        onClick={(e) => onSeek(e.clientX)}
        onTouchEnd={(e) => {
          const t = e.changedTouches[0];
          if (t) onSeek(t.clientX);
        }}
      >
        <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${progress}%` }} />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white opacity-100 shadow ring-2 ring-sky-400/40 transition sm:opacity-0 sm:group-hover:opacity-100"
          style={{ left: `calc(${progress}% - 7px)` }}
        />
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          onClick={onTogglePlay}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition sm:h-9 sm:w-9 ${
            light
              ? "bg-gradient-to-br from-sky-500 to-teal-400 text-white shadow-md shadow-sky-500/30 hover:brightness-105"
              : "bg-white/15 hover:bg-white/25"
          }`}
          title={playing ? "暂停" : "播放"}
        >
          {buffering && playing ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : playing ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
            </svg>
          ) : (
            <svg className="ml-0.5 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <span className={`shrink-0 text-[11px] tabular-nums sm:text-xs ${mutedText}`}>
          {formatTime(current)} / {formatTime(duration)}
        </span>

        <button
          onClick={onMute}
          className={`shrink-0 rounded-lg p-1.5 transition ${light ? "hover:bg-slate-200/80" : "hover:bg-white/15"}`}
          title={muted ? "取消静音" : "静音"}
        >
          {muted || volume === 0 ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5 6 9H3v6h3l5 4V5z" />
              <path d="m16 9 5 5M21 9l-5 5" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5 6 9H3v6h3l5 4V5z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" />
            </svg>
          )}
        </button>
        {/* 手机隐藏音量条（系统音量键更常用），桌面保留 */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="hidden h-1 w-12 shrink-0 cursor-pointer accent-sky-500 sm:block sm:w-16"
          title="音量"
        />

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          {onPlayMode && kind === "audio" && (
            <button
              type="button"
              onClick={onPlayMode}
              className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium transition sm:text-xs ${
                light
                  ? "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                  : "bg-white/15 hover:bg-white/25"
              }`}
              title={PLAY_MODE_META[playMode].title + " · 点击切换"}
            >
              {PLAY_MODE_META[playMode].label}
            </button>
          )}
          <button
            onClick={onRate}
            className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium tabular-nums transition ${
              light ? "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100" : "bg-white/15 hover:bg-white/25"
            }`}
            title="倍速"
          >
            {rate}x
          </button>
          {kind === "video" && onFullscreen && (
            <button
              onClick={onFullscreen}
              className="shrink-0 rounded-lg p-1.5 transition hover:bg-white/15"
              title="全屏"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {onSubChange && (kind === "video" || kind === "audio") && (
        <div className="flex items-center gap-2">
          <span className={`shrink-0 text-[11px] ${mutedText}`}>{trackLabel}</span>
          <select
            value={activeSub === "off" && kind === "audio" && subOptions[0] ? subOptions[0].id : activeSub}
            onChange={(e) => onSubChange(e.target.value)}
            disabled={!subOptions.length}
            className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[11px] outline-none disabled:opacity-50 sm:text-xs ${
              light
                ? "bg-white text-slate-600 ring-1 ring-slate-200"
                : "bg-white/15 text-white"
            }`}
            title={
              subOptions.length
                ? `选择${trackLabel}`
                : kind === "audio"
                  ? "未匹配到歌词文件"
                  : "未匹配到字幕文件"
            }
          >
            {/* 无匹配时显示提示项；视频有匹配时可关字幕 */}
            {!subOptions.length ? (
              <option value="off" className="text-slate-800">
                {subLoading
                  ? "加载中…"
                  : kind === "audio"
                    ? "未匹配到歌词文件"
                    : "未匹配到字幕文件"}
              </option>
            ) : (
              kind === "video" && (
                <option value="off" className="text-slate-800">
                  {subLoading ? "加载中…" : `关${trackLabel}`}
                </option>
              )
            )}
            {subOptions.map((t) => (
              <option key={t.id} value={t.id} className="text-slate-800" title={t.name}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
