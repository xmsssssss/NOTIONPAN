"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/utils";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MediaPlayer({
  src,
  kind,
  title,
  size,
}: {
  src: string;
  kind: "audio" | "video";
  title: string;
  size?: number;
}) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [hover, setHover] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bars] = useState(() =>
    Array.from({ length: 28 }, () => 0.25 + Math.random() * 0.75),
  );

  const setMediaRef = useCallback((node: HTMLVideoElement | HTMLAudioElement | null) => {
    mediaRef.current = node;
  }, []);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.playbackRate = rate;
  }, [rate]);

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

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={`relative w-full overflow-hidden ${kind === "video" ? "max-h-full max-w-5xl" : "max-w-xl"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {kind === "video" ? (
        <div className="relative aspect-video h-full max-h-full w-full overflow-hidden rounded-3xl bg-slate-950 shadow-2xl ring-1 ring-white/10">
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
            autoPlay
          />
          {buffering && !error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </div>
          )}
          {!playing && !error && !buffering && (
            <button
              onClick={() => void togglePlay()}
              className="absolute inset-0 flex items-center justify-center bg-black/20"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-xl transition hover:scale-105">
                <svg className="ml-1 h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>
          )}
          <div
            className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-3 pt-10 transition ${
              hover || !playing ? "opacity-100" : "opacity-0"
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
        <div className="relative overflow-hidden rounded-3xl border border-white/40 bg-gradient-to-br from-indigo-500 via-sky-500 to-teal-400 p-[1px] shadow-2xl shadow-sky-500/25">
          <div className="relative overflow-hidden rounded-[22px] bg-white">
            <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-sky-300/30 blur-3xl" />
            <div className="absolute -bottom-12 -right-8 h-44 w-44 rounded-full bg-teal-300/30 blur-3xl" />

            <div className="relative px-6 pb-5 pt-8">
              <div className="mb-6 flex flex-col items-center text-center">
                <div className="relative mb-5">
                  <div
                    className={`flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-sky-500 to-teal-400 text-white shadow-xl shadow-sky-500/30 ${
                      playing ? "animate-pulse" : ""
                    }`}
                  >
                    <svg className="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                  {playing && (
                    <div className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-end gap-0.5">
                      {bars.map((h, i) => (
                        <span
                          key={i}
                          className="np-eq w-1 origin-bottom rounded-full bg-sky-500/80"
                          style={{
                            height: `${8 + h * 14}px`,
                            animationDelay: `${i * 0.04}s`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <h3 className="max-w-full truncate px-2 text-lg font-semibold text-slate-800">{title}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  音频 · {size != null ? formatBytes(size) : "—"}
                </p>
              </div>

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
                onError={() => setError("音频加载失败")}
                autoPlay
              />

              <div className="rounded-2xl border border-slate-100 bg-slate-50/90 px-4 py-3 shadow-inner">
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
        className={`group relative h-1.5 cursor-pointer rounded-full ${track}`}
        onClick={(e) => onSeek(e.clientX)}
      >
        <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${progress}%` }} />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white opacity-0 shadow ring-2 ring-sky-400/40 transition group-hover:opacity-100"
          style={{ left: `calc(${progress}% - 7px)` }}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
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

        <span className={`min-w-[88px] text-xs tabular-nums ${mutedText}`}>
          {formatTime(current)} / {formatTime(duration)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onMute}
            className={`rounded-lg p-1.5 transition ${light ? "hover:bg-slate-200/80" : "hover:bg-white/15"}`}
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
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="h-1 w-16 cursor-pointer accent-sky-500 sm:w-20"
            title="音量"
          />
          <button
            onClick={onRate}
            className={`rounded-lg px-2 py-1 text-xs font-medium tabular-nums transition ${
              light ? "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100" : "bg-white/15 hover:bg-white/25"
            }`}
            title="倍速"
          >
            {rate}x
          </button>
          {kind === "video" && onFullscreen && (
            <button
              onClick={onFullscreen}
              className="rounded-lg p-1.5 transition hover:bg-white/15"
              title="全屏"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
