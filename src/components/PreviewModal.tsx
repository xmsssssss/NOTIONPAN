"use client";

import { useEffect, useMemo, useState } from "react";
import type { DriveFile } from "@/lib/types";
import { fileDownloadHref } from "@/lib/client-file";
import { listLyricFiles, listSubtitleFiles } from "@/lib/subtitle";
import { formatBytes, formatDate } from "@/lib/utils";
import { FileIcon } from "./FileIcon";
import { IconClose, IconDownload } from "./icons";
import { MediaPlayer, type PlayMode } from "./MediaPlayer";

const TEXT_EXTS =
  /\.(txt|md|markdown|json|csv|xml|yaml|yml|html|htm|css|js|ts|jsx|tsx|log|ini|conf|sh|py|java|c|cpp|h|hpp|go|rs|rb|php|sql|ass|ssa|srt|vtt|lrc)$/i;

function isTextFile(file: DriveFile): boolean {
  if (file.mimeType.startsWith("text/")) return true;
  if (file.mimeType === "application/json") return true;
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
  const src = fileDownloadHref(file.id);

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

  const playNextInList = () => {
    // 音频由上层常驻 audio 的 onEnded 处理列表循环，避免双重切歌
    if (externalAudio) return;
    if (playlist.length < 2) return;
    const idx = playlist.findIndex((f) => f.id === file.id);
    const next = playlist[(idx + 1 + playlist.length) % playlist.length];
    if (next) selectFile(next);
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
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [listOpen, setListOpen] = useState(true);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setPdfLoaded(false);
    setTextContent(null);
    setTextError(null);

    if (!isTextFile(file)) return;
    setLoadingText(true);

    fetch(`/api/files/${file.id}/download?proxy=1`, { credentials: "include" })
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
        setTextContent(text.slice(0, 500000));
        setLoadingText(false);
      })
      .catch((err) => {
        setTextError(err instanceof Error ? err.message : "加载失败");
        setLoadingText(false);
      });
  }, [file.id, file.kind, file.mimeType, file.name]);

  const isVideo = file.kind === "video";
  const isAudio = file.kind === "audio";
  const showPlaylist = (isVideo || isAudio) && playlist.length > 0;
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
            ? "safe-top safe-bottom relative z-10 flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[min(88dvh,760px)] sm:w-full sm:max-w-5xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-white/20 sm:shadow-2xl"
            : isAudio
              ? "safe-top safe-bottom relative z-10 flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[min(86dvh,620px)] sm:w-full sm:max-w-3xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-white/20 sm:shadow-2xl"
              : "safe-top safe-bottom relative z-10 flex h-full w-full flex-col bg-white sm:h-[min(82dvh,720px)] sm:w-full sm:max-w-4xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-white/20 sm:shadow-2xl"
        }
        style={{
          boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
        }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-2.5">
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 sm:order-last sm:h-8 sm:w-8"
            aria-label="关闭"
          >
            <IconClose className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">{file.name}</div>
            <div className="truncate text-[11px] text-slate-500">
              {formatBytes(file.size)}
              <span className="hidden sm:inline"> · {formatDate(file.createdTime)}</span>
            </div>
          </div>

          {showPlaylist && (
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:hidden"
            >
              {listOpen ? "收起列表" : "列表"}
            </button>
          )}

          {isAudio && onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              title="最小化到左下角（后台播放）"
            >
              最小化
            </button>
          )}

          <a
            href={src}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25 active:scale-95 sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-sm sm:font-medium"
            title="下载"
          >
            <IconDownload className="h-4 w-4" />
            <span className="hidden sm:inline">下载</span>
          </a>
        </div>

        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-white">
          {/* 左侧播放列表 */}
          {showPlaylist && (
            <aside
              className={`flex w-full shrink-0 flex-col border-slate-200 bg-slate-50/90 sm:w-52 sm:border-r md:w-56 ${
                listOpen ? "absolute inset-0 z-20 sm:static sm:z-0" : "hidden sm:flex"
              }`}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
                <span className="text-xs font-semibold text-slate-600">
                  {isAudio ? "音乐列表" : "视频列表"}
                  <span className="ml-1 font-normal text-slate-400">({playlist.length})</span>
                </span>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white sm:hidden"
                  onClick={() => setListOpen(false)}
                >
                  关闭
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
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
                      className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
                        active
                          ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                          : "text-slate-700 hover:bg-white"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs ${
                          active ? "bg-sky-500 text-white" : "bg-white text-slate-400 ring-1 ring-slate-200"
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
                        <span className="block text-[10px] text-slate-400">{formatBytes(item.size)}</span>
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
              <div className="flex h-full w-full items-center justify-center overflow-auto p-2 sm:p-4">
                {!imageLoaded && !imageError && <LoadingBlock label="图片加载中…" />}
                {imageError ? (
                  <div className="text-center text-sm text-slate-500">图片加载失败，请下载查看</div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={file.name}
                    onLoad={() => setImageLoaded(true)}
                    onError={() => {
                      setImageError(true);
                      setImageLoaded(true);
                    }}
                    className={`max-h-full max-w-full object-contain transition-opacity duration-200 sm:rounded-2xl sm:shadow-2xl ${
                      imageLoaded ? "opacity-100" : "absolute opacity-0"
                    }`}
                  />
                )}
              </div>
            )}

            {file.kind === "video" && (
              <div className="flex h-full min-h-0 w-full items-center justify-center bg-white p-0 sm:p-2">
                <div className="flex h-full max-h-full w-full items-center justify-center">
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
              <div className="flex h-full w-full items-center justify-center overflow-y-auto p-3 sm:p-4">
                <div className="w-full max-w-md">
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
              <div className="relative h-full w-full min-h-0">
                {!pdfLoaded && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/80">
                    <LoadingBlock label="PDF 加载中…" />
                  </div>
                )}
                <iframe
                  src={src}
                  title={file.name}
                  onLoad={() => setPdfLoaded(true)}
                  className="h-full w-full bg-white"
                />
              </div>
            )}

            {file.kind === "file" && isTextFile(file) && (
              <div className="flex h-full w-full min-h-0 flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/90 px-3 py-2 sm:px-4 sm:py-3">
                  <span className="text-sm font-medium text-slate-700">文本预览</span>
                  {loadingText && (
                    <span className="flex items-center gap-1.5 text-xs text-blue-600">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                      加载中…
                    </span>
                  )}
                  {textError && (
                    <span className="max-w-[60%] truncate text-xs text-red-500" title={textError}>
                      {textError}
                    </span>
                  )}
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
                  <FileIcon kind={file.kind} className="h-10 w-10 sm:h-12 sm:w-12" />
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
      </div>
    </div>
  );
}
