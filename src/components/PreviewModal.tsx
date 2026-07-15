"use client";

import { useEffect, useState } from "react";
import type { DriveFile } from "@/lib/types";
import { formatBytes, formatDate } from "@/lib/utils";
import { IconClose, IconDownload } from "./icons";
import { MediaPlayer } from "./MediaPlayer";

const TEXT_EXTS =
  /\.(txt|md|markdown|json|csv|xml|yaml|yml|html|htm|css|js|ts|jsx|tsx|log|ini|conf|sh|py|java|c|cpp|h|hpp|go|rs|rb|php|sql)$/i;

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
  file,
  onClose,
}: {
  file: DriveFile;
  onClose: () => void;
}) {
  const src = `/api/files/${file.id}/download`;
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [pdfLoaded, setPdfLoaded] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setPdfLoaded(false);
    setTextContent(null);
    setTextError(null);

    if (!isTextFile(file)) return;
    setLoadingText(true);
    fetch(`/api/files/${file.id}/download?proxy=1`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm sm:bg-gradient-to-br sm:from-slate-900/60 sm:via-slate-800/50 sm:to-slate-900/60"
        onClick={onClose}
      />

      <div
        className="safe-top safe-bottom relative z-10 flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[92dvh] sm:max-w-6xl sm:overflow-hidden sm:rounded-3xl sm:border sm:border-white/20 sm:shadow-2xl"
        style={{
          boxShadow: "0 25px 80px rgba(0,0,0,0.25)",
        }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3.5">
          <button
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 active:bg-slate-100 sm:order-last sm:h-9 sm:w-9"
            aria-label="关闭"
          >
            <IconClose className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800 sm:text-base">{file.name}</div>
            <div className="truncate text-[11px] text-slate-500 sm:text-xs">
              {formatBytes(file.size)}
              <span className="hidden sm:inline"> · {formatDate(file.createdTime)}</span>
            </div>
          </div>

          <a
            href={`/api/files/${file.id}/download`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25 active:scale-95 sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-sm sm:font-medium"
            title="下载"
          >
            <IconDownload className="h-4 w-4" />
            <span className="hidden sm:inline">下载</span>
          </a>
        </div>

        {/* Content - fills remaining height on mobile */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
          {file.kind === "image" && (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-2 sm:p-6">
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
            <div className="flex h-full w-full items-center justify-center bg-black p-0 sm:bg-transparent sm:p-4">
              <div className="h-full w-full sm:h-auto sm:max-h-full">
                <MediaPlayer src={src} kind="video" title={file.name} size={file.size} />
              </div>
            </div>
          )}

          {file.kind === "audio" && (
            <div className="flex h-full w-full items-center justify-center p-4 sm:p-10">
              <MediaPlayer src={src} kind="audio" title={file.name} size={file.size} />
            </div>
          )}

          {file.kind === "pdf" && (
            <div className="relative h-full w-full">
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
            <div className="flex h-full w-full flex-col">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/90 px-3 py-2 sm:px-4 sm:py-3">
                <span className="text-sm font-medium text-slate-700">文本预览</span>
                {loadingText && (
                  <span className="flex items-center gap-1.5 text-xs text-blue-600">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                    加载中…
                  </span>
                )}
                {textError && <span className="text-xs text-red-500">{textError}</span>}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {loadingText && !textContent ? (
                  <div className="flex h-full items-center justify-center py-16">
                    <LoadingBlock label="读取文本…" />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words bg-white p-3 text-xs leading-relaxed text-slate-800 sm:p-4">
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
                <svg className="h-10 w-10 sm:h-12 sm:w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18v-6" />
                  <path d="M9 15l3 3 3-3" />
                </svg>
              </div>
              <div>
                <h3 className="mb-1 text-base font-semibold text-slate-700 sm:text-lg">暂不支持预览</h3>
                <p className="text-sm text-slate-500">请下载后查看</p>
              </div>
              <a
                href={`/api/files/${file.id}/download`}
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
  );
}
