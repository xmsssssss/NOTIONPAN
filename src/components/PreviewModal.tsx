"use client";

import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import type { DriveFile } from "@/lib/types";
import { fileDownloadHref } from "@/lib/client-file";
import { listLyricFiles, listSubtitleFiles } from "@/lib/subtitle";
import { isMarkdownFile, renderMarkdown } from "@/lib/markdown";
import { formatBytes, formatDate } from "@/lib/utils";
import { FileIcon } from "./FileIcon";
import { IconClose, IconDownload } from "./icons";
import { MediaPlayer, type PlayMode } from "./MediaPlayer";
import { ThumbImage } from "./ThumbImage";

const TEXT_EXTS =
  /\.(txt|md|markdown|mdown|mkd|json|csv|xml|yaml|yml|html|htm|css|js|ts|jsx|tsx|log|ini|conf|sh|py|java|c|cpp|h|hpp|go|rs|rb|php|sql|ass|ssa|srt|vtt|lrc)$/i;

function isTextFile(file: DriveFile): boolean {
  if (file.mimeType.startsWith("text/")) return true;
  if (file.mimeType === "application/json") return true;
  if (file.mimeType === "text/markdown" || file.mimeType === "text/x-markdown") {
    return true;
  }
  return TEXT_EXTS.test(file.name);
}

function LoadingBlock({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-slate-500">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function PreviewModal({
  file: initialFile,
  siblings = [],
  autoPlay = true,
  /** 音频由上层常驻 <audio> 播放时，弹窗内不再挂载 audio 元素 */
  externalAudio = false,
  externalAudioEl = null,
  playMode: playModeProp,
  onPlayModeChange,
  onCurrentChange,
  onMinimize,
  onClose,
}: {
  file: DriveFile;
  /** 当前目录文件列表，用于匹配同名字幕 / 播放列表 */
  siblings?: DriveFile[];
  autoPlay?: boolean;
  externalAudio?: boolean;
  externalAudioEl?: HTMLAudioElement | null;
  /** 受控播放模式（音频后台迷你条复用） */
  playMode?: PlayMode;
  onPlayModeChange?: (mode: PlayMode) => void;
  /** 切换当前曲目/视频时通知上层 */
  onCurrentChange?: (file: DriveFile) => void;
  /** 音频：最小化到左下角迷你条（后台继续播） */
  onMinimize?: () => void;
  onClose: () => void;
}) {
  // 当前播放项（可在同级列表中切换）
  const [current, setCurrent] = useState<DriveFile>(initialFile);
  const [localPlayMode, setLocalPlayMode] = useState<PlayMode>("once");
  const playMode = playModeProp ?? localPlayMode;
  const setPlayMode = onPlayModeChange ?? setLocalPlayMode;

  useEffect(() => {
    setCurrent(initialFile);
  }, [initialFile.id]);

  const selectFile = (next: DriveFile) => {
    setCurrent(next);
    onCurrentChange?.(next);
  };

  const file = current;
  /** 媒体默认直连下载入口；PDF 走同源反代，兼容 Edge 等无法 iframe 外链的浏览器 */
  const src =
    file.kind === "pdf"
      ? `${fileDownloadHref(file.id)}?proxy=1`
      : fileDownloadHref(file.id);

  const siblingKey = siblings.map((f) => f.id).join(",");

  const playlist = useMemo(() => {
    if (file.kind === "video") {
      return siblings.filter((f) => f.kind === "video");
    }
    if (file.kind === "audio") {
      return siblings.filter((f) => f.kind === "audio");
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.kind, siblingKey]);

  /** 同目录图片列表（桌面走马灯） */
  const imageList = useMemo(() => {
    if (file.kind !== "image") return [];
    return siblings.filter((f) => f.kind === "image");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.kind, siblingKey]);

  const imageIndex = useMemo(
    () => imageList.findIndex((f) => f.id === file.id),
    [imageList, file.id],
  );

  const stepImage = (delta: number) => {
    if (imageList.length < 2) return;
    const idx = imageIndex >= 0 ? imageIndex : 0;
    const next = imageList[(idx + delta + imageList.length) % imageList.length];
    if (next) selectFile(next);
  };

  const playNextInList = () => {
    // 音频由上层常驻 audio 的 onEnded 处理列表循环，避免双重切歌
    if (externalAudio) return;
    if (playlist.length < 2) return;
    const idx = playlist.findIndex((f) => f.id === file.id);
    const next = playlist[(idx + 1 + playlist.length) % playlist.length];
    if (next) selectFile(next);
  };

  const thumbStripRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  // 当前图缩略图滚入可视区
  useEffect(() => {
    if (file.kind !== "image" || imageIndex < 0) return;
    const root = thumbStripRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-img-id="${file.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [file.id, file.kind, imageIndex]);

  // 桌面方向键切换图片
  useEffect(() => {
    if (file.kind !== "image" || imageList.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepImage(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepImage(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.kind, file.id, imageList, imageIndex]);

  const onImageTouchStart = (e: ReactTouchEvent) => {
    if (imageList.length < 2) return;
    const t = e.touches[0];
    if (!t) return;
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const onImageTouchEnd = (e: ReactTouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || imageList.length < 2) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // 水平滑动优先；阈值约 48px
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) stepImage(1);
    else stepImage(-1);
  };

  // 字幕 / 歌词：按文件名与当前媒体匹配（同名或 片名.语言）
  const subtitleFiles = useMemo(
    () => (file.kind === "video" ? listSubtitleFiles(file.name, siblings) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file.kind, file.name, siblingKey],
  );
  const lyricFiles = useMemo(
    () => (file.kind === "audio" ? listLyricFiles(file.name, siblings) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file.kind, file.name, siblingKey],
  );

  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [mdMode, setMdMode] = useState<"preview" | "source">("preview");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  // 手机默认收起，避免一打开就被列表盖住播放器；桌面侧栏始终显示
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setPdfLoaded(false);
    setTextContent(null);
    setTextError(null);
    setMdMode("preview");

    // PDF object/iframe 部分浏览器不触发 onLoad，超时后去掉遮罩
    let pdfTimer: ReturnType<typeof setTimeout> | null = null;
    if (file.kind === "pdf") {
      pdfTimer = setTimeout(() => setPdfLoaded(true), 2500);
    }

    if (!isTextFile(file)) {
      return () => {
        if (pdfTimer) clearTimeout(pdfTimer);
      };
    }
    setLoadingText(true);

    let cancelled = false;
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;

    fetch(`/api/files/${file.id}/download?proxy=1`, {
      credentials: "include",
      signal: ac?.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          let msg = `加载失败（HTTP ${res.status}）`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) msg = data.error;
          } catch {
            // ignore
          }
          throw new Error(msg);
        }
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        setTextContent(text.slice(0, 500000));
        setLoadingText(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setTextError(err instanceof Error ? err.message : "加载失败");
        setLoadingText(false);
      });

    return () => {
      cancelled = true;
      ac?.abort();
      if (pdfTimer) clearTimeout(pdfTimer);
    };
  }, [file.id, file.kind, file.mimeType, file.name]);

  const isVideo = file.kind === "video";
  const isAudio = file.kind === "audio";
  const isImage = file.kind === "image";
  const showPlaylist = (isVideo || isAudio) && playlist.length > 0;
  const showImageStrip = isImage && imageList.length > 0;
  const trackLabel = isAudio ? "歌词" : "字幕";
  const trackFiles = isAudio ? lyricFiles : subtitleFiles;

  return (
    <div className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center sm:p-3">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm sm:bg-gradient-to-br sm:from-slate-900/60 sm:via-slate-800/50 sm:to-slate-900/60"
        onClick={onClose}
      />

      <div
        className={
          isVideo
            ? "safe-top safe-bottom relative z-10 flex h-full min-h-0 w-full flex-col bg-black sm:h-auto sm:max-h-[min(88dvh,760px)] sm:w-full sm:max-w-5xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-white/20 sm:bg-white sm:shadow-2xl"
            : isAudio
              ? "safe-top safe-bottom relative z-10 flex h-full min-h-0 w-full flex-col bg-white sm:h-auto sm:max-h-[min(86dvh,620px)] sm:w-full sm:max-w-3xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-white/20 sm:shadow-2xl"
              : isImage
                ? "safe-top safe-bottom relative z-10 flex h-full min-h-0 w-full flex-col bg-white sm:h-[min(88dvh,780px)] sm:w-full sm:max-w-5xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-white/20 sm:shadow-2xl"
                : "safe-top safe-bottom relative z-10 flex h-full min-h-0 w-full flex-col bg-white sm:h-[min(82dvh,720px)] sm:w-full sm:max-w-4xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-white/20 sm:shadow-2xl"
        }
        style={{
          boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
        }}
      >
        <div
          className={`flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:gap-2.5 sm:border-slate-200/80 sm:bg-white sm:px-4 sm:py-2.5 ${
            isVideo
              ? "border-white/10 bg-black/90 text-white"
              : "border-slate-200/80 bg-white"
          }`}
        >
          <button
            onClick={onClose}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg active:bg-white/10 sm:order-last sm:h-8 sm:w-8 sm:text-slate-500 sm:active:bg-slate-100 ${
              isVideo ? "text-white/90" : "text-slate-500"
            }`}
            aria-label="关闭"
          >
            <IconClose className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <div
              className={`truncate text-sm font-semibold ${
                isVideo ? "text-white" : "text-slate-800"
              }`}
            >
              {file.name}
            </div>
            <div
              className={`truncate text-[11px] ${
                isVideo ? "text-white/60" : "text-slate-500"
              }`}
            >
              {formatBytes(file.size)}
              <span className="hidden sm:inline"> · {formatDate(file.createdTime)}</span>
            </div>
          </div>

          {showPlaylist && (
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium sm:hidden ${
                isVideo
                  ? "border-white/20 text-white/90 active:bg-white/10"
                  : "border-slate-200 text-slate-600 active:bg-slate-50"
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" />
              </svg>
              {listOpen ? "收起" : "列表"}
              <span className={`tabular-nums ${isVideo ? "text-white/50" : "text-slate-400"}`}>
                {Math.max(1, playlist.findIndex((f) => f.id === file.id) + 1)}/{playlist.length}
              </span>
            </button>
          )}

          {isAudio && onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 active:bg-slate-50"
              title="最小化到左下角（后台播放）"
            >
              最小化
            </button>
          )}

          <a
            href={src}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg active:scale-95 sm:h-auto sm:w-auto sm:gap-1.5 sm:bg-gradient-to-r sm:from-blue-500 sm:to-blue-600 sm:px-3 sm:py-1.5 sm:text-sm sm:font-medium sm:text-white sm:shadow-md sm:shadow-blue-500/25 ${
              isVideo
                ? "bg-white/15 text-white"
                : "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25"
            }`}
            title="下载"
          >
            <IconDownload className="h-4 w-4" />
            <span className="hidden sm:inline">下载</span>
          </a>
        </div>

        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-white">
          {/* 桌面：左侧播放列表 */}
          {showPlaylist && (
            <aside className="hidden w-52 shrink-0 flex-col border-r border-slate-200 bg-slate-50/90 sm:flex md:w-56">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
                <span className="text-xs font-semibold text-slate-600">
                  {isAudio ? "音乐列表" : "视频列表"}
                  <span className="ml-1 font-normal text-slate-400">({playlist.length})</span>
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
                {playlist.map((item, idx) => {
                  const active = item.id === file.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectFile(item)}
                      className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
                        active
                          ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                          : "text-slate-700 hover:bg-white"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs ${
                          active
                            ? "bg-sky-500 text-white"
                            : "bg-white text-slate-400 ring-1 ring-slate-200"
                        }`}
                      >
                        {active ? (
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        ) : (
                          <span className="tabular-nums">{idx + 1}</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{item.name}</span>
                        <span className="block text-[10px] text-slate-400">
                          {formatBytes(item.size)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}

          {/* 主内容 */}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {file.kind === "image" && (
              <div className="flex h-full min-h-0 w-full flex-col">
                <div
                  className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center overflow-hidden bg-slate-50/60 p-2 sm:p-4"
                  onTouchStart={onImageTouchStart}
                  onTouchEnd={onImageTouchEnd}
                >
                  {!imageLoaded && !imageError && <LoadingBlock label="图片加载中…" />}
                  {imageError ? (
                    <div className="text-center text-sm text-slate-500">
                      图片加载失败，请下载查看
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt={file.name}
                      draggable={false}
                      onLoad={() => setImageLoaded(true)}
                      onError={() => {
                        setImageError(true);
                        setImageLoaded(true);
                      }}
                      className={`max-h-full max-w-full select-none object-contain transition-opacity duration-200 sm:rounded-xl sm:shadow-xl ${
                        imageLoaded ? "opacity-100" : "absolute opacity-0"
                      }`}
                    />
                  )}

                  {/* 左右切换：手机半透明小按钮，桌面大圆钮 */}
                  {showImageStrip && imageList.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => stepImage(-1)}
                        className="absolute left-1.5 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/35 text-white shadow-md backdrop-blur-sm active:scale-95 sm:left-2 sm:h-11 sm:w-11 sm:border-slate-200/80 sm:bg-white/95 sm:text-slate-700 sm:hover:bg-white sm:hover:text-sky-600"
                        title="上一张（←）"
                        aria-label="上一张"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => stepImage(1)}
                        className="absolute right-1.5 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/35 text-white shadow-md backdrop-blur-sm active:scale-95 sm:right-2 sm:h-11 sm:w-11 sm:border-slate-200/80 sm:bg-white/95 sm:text-slate-700 sm:hover:bg-white sm:hover:text-sky-600"
                        title="下一张（→）"
                        aria-label="下一张"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] tabular-nums text-white sm:bottom-3">
                        {Math.max(1, imageIndex + 1)} / {imageList.length}
                      </div>
                    </>
                  )}
                </div>

                {/* 底部图片走马灯：手机 + 桌面 */}
                {showImageStrip && (
                  <div className="safe-bottom shrink-0 border-t border-slate-200 bg-white">
                    <div className="flex items-center gap-0.5 px-2 py-2 sm:gap-1 sm:px-3">
                      <button
                        type="button"
                        onClick={() => stepImage(-1)}
                        disabled={imageList.length < 2}
                        className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 disabled:opacity-30 sm:h-9 sm:w-9 sm:hover:bg-slate-100"
                        title="上一张"
                        aria-label="上一张"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <div
                        ref={thumbStripRef}
                        className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto overscroll-x-contain px-0.5 py-0.5 [-webkit-overflow-scrolling:touch] [-ms-overflow-style:none] [scrollbar-width:thin] sm:gap-2 sm:px-1 [&::-webkit-scrollbar]:h-1.5"
                      >
                        {imageList.map((item, idx) => {
                          const active = item.id === file.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-img-id={item.id}
                              title={item.name}
                              onClick={() => selectFile(item)}
                              className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg transition sm:h-16 sm:w-16 ${
                                active
                                  ? "ring-2 ring-sky-500 ring-offset-1"
                                  : "ring-1 ring-slate-200 active:ring-sky-300 sm:hover:ring-sky-300"
                              }`}
                            >
                              <ThumbImage
                                id={item.id}
                                kind={item.kind}
                                name={item.name}
                                className="h-full w-full"
                              />
                              <span
                                className={`absolute bottom-0.5 right-0.5 rounded px-1 text-[9px] tabular-nums ${
                                  active
                                    ? "bg-sky-500 text-white"
                                    : "bg-black/45 text-white/90"
                                }`}
                              >
                                {idx + 1}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => stepImage(1)}
                        disabled={imageList.length < 2}
                        className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 disabled:opacity-30 sm:h-9 sm:w-9 sm:hover:bg-slate-100"
                        title="下一张"
                        aria-label="下一张"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {file.kind === "video" && (
              <div className="flex h-full min-h-0 w-full flex-col bg-black sm:bg-white sm:p-2">
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <MediaPlayer
                    key={file.id}
                    src={src}
                    kind="video"
                    title={file.name}
                    size={file.size}
                    subtitleFiles={trackFiles}
                    autoPlay={autoPlay}
                  />
                </div>
              </div>
            )}

            {file.kind === "audio" && (
              <div className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto p-3 sm:p-4">
                <div className="my-auto w-full max-w-md">
                  <MediaPlayer
                    key={externalAudio ? `audio-ext-${file.id}` : file.id}
                    src={src}
                    kind="audio"
                    title={file.name}
                    size={file.size}
                    subtitleFiles={trackFiles}
                    autoPlay={externalAudio ? false : autoPlay}
                    externalMedia={externalAudio}
                    externalAudioEl={externalAudioEl}
                    playMode={playMode}
                    onPlayModeChange={setPlayMode}
                    onEnded={playNextInList}
                  />
                </div>
              </div>
            )}

            {file.kind === "pdf" && (
              <div className="relative h-full w-full min-h-0 bg-slate-100">
                {!pdfLoaded && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/80">
                    <LoadingBlock label="PDF 加载中…" />
                  </div>
                )}
                {/* object 优先（Edge 对同源 PDF 更稳），iframe 兜底 */}
                <object
                  data={src}
                  type="application/pdf"
                  title={file.name}
                  className="h-full w-full bg-white"
                  onLoad={() => setPdfLoaded(true)}
                >
                  <iframe
                    src={src}
                    title={file.name}
                    onLoad={() => setPdfLoaded(true)}
                    className="h-full w-full bg-white"
                  />
                </object>
                {pdfLoaded && (
                  <div className="pointer-events-none absolute bottom-2 right-2 z-10 sm:bottom-3 sm:right-3">
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pointer-events-auto rounded-lg bg-black/55 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm hover:bg-black/70"
                    >
                      新标签打开
                    </a>
                  </div>
                )}
              </div>
            )}

            {file.kind === "file" && isTextFile(file) && (
              <div className="flex h-full w-full min-h-0 flex-col">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/90 px-3 py-2 sm:px-4 sm:py-3">
                  <span className="text-sm font-medium text-slate-700">
                    {isMarkdownFile(file.name, file.mimeType) ? "Markdown" : "文本预览"}
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    {isMarkdownFile(file.name, file.mimeType) && textContent && !textError && (
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setMdMode("preview")}
                          className={`rounded-md px-2 py-1 font-medium ${
                            mdMode === "preview"
                              ? "bg-sky-500 text-white"
                              : "text-slate-500 hover:bg-slate-50"
                          }`}
                        >
                          预览
                        </button>
                        <button
                          type="button"
                          onClick={() => setMdMode("source")}
                          className={`rounded-md px-2 py-1 font-medium ${
                            mdMode === "source"
                              ? "bg-sky-500 text-white"
                              : "text-slate-500 hover:bg-slate-50"
                          }`}
                        >
                          源码
                        </button>
                      </div>
                    )}
                    {loadingText && (
                      <span className="flex items-center gap-1.5 text-xs text-blue-600">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                        加载中…
                      </span>
                    )}
                    {textError && (
                      <span className="max-w-[40%] truncate text-xs text-red-500" title={textError}>
                        {textError}
                      </span>
                    )}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {loadingText && !textContent ? (
                    <div className="flex h-full items-center justify-center py-16">
                      <LoadingBlock label="读取文本…" />
                    </div>
                  ) : textError && !textContent ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="text-sm text-slate-500">{textError}</p>
                      <a
                        href={src}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-2.5 text-sm font-medium text-white"
                      >
                        <IconDownload className="h-4 w-4" />
                        下载文件
                      </a>
                    </div>
                  ) : isMarkdownFile(file.name, file.mimeType) && mdMode === "preview" ? (
                    <div
                      className="np-md-body min-h-full bg-white p-4 sm:p-6"
                      // 已 escape + 白名单链接，无用户自定义 HTML
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(textContent || ""),
                      }}
                    />
                  ) : (
                    <pre className="min-h-full whitespace-pre-wrap break-words bg-white p-3 text-xs leading-relaxed text-slate-800 sm:p-4">
                      <code>{textContent ?? ""}</code>
                    </pre>
                  )}
                </div>
                <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50/80 px-3 py-2 sm:px-4">
                  <span className="text-xs text-slate-400">最大 500KB</span>
                  <span className="text-xs text-slate-400">{textContent?.length ?? 0} 字符</span>
                </div>
              </div>
            )}

            {file.kind === "file" && !isTextFile(file) && (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 shadow-inner sm:h-24 sm:w-24">
                  <FileIcon kind={file.kind} name={file.name} className="h-12 w-12 sm:h-14 sm:w-14" />
                </div>
                <div>
                  <h3 className="mb-1 text-base font-semibold text-slate-700 sm:text-lg">暂不支持预览</h3>
                  <p className="text-sm text-slate-500">请下载后查看</p>
                </div>
                <a
                  href={src}
                  className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-blue-500/25 active:scale-[0.98]"
                >
                  <IconDownload className="h-4 w-4" />
                  下载文件
                </a>
              </div>
            )}
          </div>
        </div>

        {/* 手机：底部播放列表抽屉（不挡播放器） */}
        {showPlaylist && listOpen && (
          <div className="absolute inset-0 z-30 flex flex-col justify-end sm:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40"
              aria-label="关闭列表"
              onClick={() => setListOpen(false)}
            />
            <div className="safe-bottom relative flex max-h-[min(62dvh,28rem)] min-h-[40dvh] flex-col rounded-t-3xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex justify-center pt-2">
                <div className="h-1 w-10 rounded-full bg-slate-200" />
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">
                    {isAudio ? "音乐列表" : "视频列表"}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    共 {playlist.length} 项 · 当前{" "}
                    {Math.max(1, playlist.findIndex((f) => f.id === file.id) + 1)}
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 active:bg-slate-100"
                  onClick={() => setListOpen(false)}
                  aria-label="关闭"
                >
                  <IconClose className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 [-webkit-overflow-scrolling:touch]">
                {playlist.map((item, idx) => {
                  const active = item.id === file.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        selectFile(item);
                        setListOpen(false);
                      }}
                      className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition active:scale-[0.99] ${
                        active
                          ? "bg-sky-50 text-sky-900 ring-1 ring-sky-200"
                          : "text-slate-800 active:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm ${
                          active
                            ? "bg-sky-500 text-white shadow-sm shadow-sky-500/30"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {active ? (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        ) : (
                          <span className="tabular-nums font-medium">{idx + 1}</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium leading-snug">
                          {item.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-400">
                          {formatBytes(item.size)}
                        </span>
                      </span>
                      {active && (
                        <span className="shrink-0 text-[11px] font-medium text-sky-600">播放中</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
