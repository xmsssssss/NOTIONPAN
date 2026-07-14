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

function Stage({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative flex h-[min(70vh,720px)] w-full items-center justify-center overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
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
  const src = `/api/files/${file.id}/download?redirect=1`;
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
    fetch(`/api/files/${file.id}/download`)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-900/60 via-slate-800/50 to-slate-900/60 backdrop-blur-md"
        onClick={onClose}
      />

      <div
        className="relative z-10 flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl"
        style={{
          boxShadow: "0 25px 80px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.1) inset",
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-gradient-to-r from-white via-slate-50 to-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-teal-400 text-white shadow-lg shadow-blue-500/25">
              {file.kind === "image" && (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              )}
              {file.kind === "video" && (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M10 9l5 3-5 3V9z" />
                </svg>
              )}
              {file.kind === "audio" && (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              )}
              {file.kind === "pdf" && (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M16 13H8" />
                  <path d="M16 17H8" />
                  <path d="M10 9H8" />
                </svg>
              )}
              {file.kind === "file" && isTextFile(file) && (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h8" />
                  <path d="M8 17h8" />
                  <path d="M8 9h2" />
                </svg>
              )}
              {file.kind === "file" && !isTextFile(file) && (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-slate-800">{file.name}</div>
              <div className="text-xs text-slate-500">
                {formatBytes(file.size)} · {formatDate(file.createdTime)}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`/api/files/${file.id}/download`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/25 transition-all hover:scale-105 hover:shadow-blue-500/40"
            >
              <IconDownload className="h-4 w-4" />
              下载
            </a>
            <button
              onClick={onClose}
              className="group rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600"
            >
              <IconClose className="h-5 w-5 transition-transform group-hover:rotate-90" />
            </button>
          </div>
        </div>

        <div className="relative bg-gradient-to-br from-slate-50 via-white to-slate-100">
          {file.kind === "image" && (
            <Stage className="p-4 sm:p-6">
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
                  className={`max-h-full max-w-full rounded-2xl object-contain shadow-2xl transition-opacity duration-200 ${
                    imageLoaded ? "opacity-100" : "absolute opacity-0"
                  }`}
                />
              )}
            </Stage>
          )}

          {file.kind === "video" && (
            <Stage className="p-4 sm:p-6">
              <MediaPlayer src={src} kind="video" title={file.name} size={file.size} />
            </Stage>
          )}

          {file.kind === "audio" && (
            <Stage className="p-6 sm:p-10">
              <MediaPlayer src={src} kind="audio" title={file.name} size={file.size} />
            </Stage>
          )}

          {file.kind === "pdf" && (
            <Stage className="p-4">
              {!pdfLoaded && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/80">
                  <LoadingBlock label="PDF 加载中…" />
                </div>
              )}
              <iframe
                src={src}
                title={file.name}
                onLoad={() => setPdfLoaded(true)}
                className="h-full w-full max-w-5xl rounded-2xl bg-white shadow-2xl"
              />
            </Stage>
          )}

          {file.kind === "file" && isTextFile(file) && (
            <Stage className="p-4 sm:p-6">
              <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M8 13h8" />
                        <path d="M8 17h8" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-slate-700">文本预览</span>
                  </div>
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
                    <div className="flex h-full items-center justify-center">
                      <LoadingBlock label="读取文本…" />
                    </div>
                  ) : (
                    <pre className="h-full bg-white p-4 text-xs leading-relaxed text-slate-800">
                      <code>{textContent ?? ""}</code>
                    </pre>
                  )}
                </div>
                <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50/50 px-4 py-2">
                  <span className="text-xs text-slate-400">最大预览 500KB</span>
                  <span className="text-xs text-slate-400">{textContent?.length ?? 0} 字符</span>
                </div>
              </div>
            </Stage>
          )}

          {file.kind === "file" && !isTextFile(file) && (
            <Stage className="p-8">
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 shadow-inner">
                  <svg className="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M12 18v-6" />
                    <path d="M9 15l3 3 3-3" />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-slate-700">暂不支持预览</h3>
                <p className="mb-6 text-sm text-slate-500">此文件类型无法在线预览，请下载后查看</p>
                <a
                  href={`/api/files/${file.id}/download`}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-blue-500/25 transition-all hover:scale-105 hover:shadow-blue-500/40"
                >
                  <IconDownload className="h-4 w-4" />
                  下载文件
                </a>
              </div>
            </Stage>
          )}
        </div>
      </div>
    </div>
  );
}
