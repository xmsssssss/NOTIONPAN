"use client";

import { useEffect, useState } from "react";
import { isMarkdownFile, renderMarkdown } from "@/lib/markdown";
import { formatBytes } from "@/lib/utils";
import { IconDownload } from "./icons";
import { MediaPlayer } from "./MediaPlayer";

type ShareInfo = {
  token: string;
  fileName: string;
  mimeType: string;
  kind: string;
  size: number;
  hasPassword: boolean;
  expiresAt: string | null;
  allowDownload: boolean;
  allowPreview: boolean;
  unlocked: boolean;
  error?: string;
};

const TEXT_EXTS =
  /\.(txt|md|markdown|json|csv|xml|yaml|yml|html|htm|css|js|ts|jsx|tsx|log|ini|conf|sh|py)$/i;

function isText(name: string, mime: string) {
  return mime.startsWith("text/") || mime === "application/json" || TEXT_EXTS.test(name);
}

export function SharePage({ token }: { token: string }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/s/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setInfo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    if (!info?.unlocked || !info.allowPreview) return;
    if (info.kind !== "file" || !isText(info.fileName, info.mimeType)) return;
    fetch(`/api/s/${token}/download?preview=1`)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => setText(t.slice(0, 500000)))
      .catch(() => setText(null));
  }, [info, token]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/s/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "验证失败");
      setInfo((prev) => (prev ? { ...prev, ...data, unlocked: true } : data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        加载分享…
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
          {error || "分享不存在或已失效"}
        </div>
      </div>
    );
  }

  if (info.hasPassword && !info.unlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <form
          onSubmit={(e) => void unlock(e)}
          className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <h1 className="text-lg font-bold text-slate-800">分享需要密码</h1>
          <p className="mt-1 truncate text-sm text-slate-500">{info.fileName}</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            placeholder="输入分享密码"
            required
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-sky-500 to-teal-400 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "验证中…" : "解锁"}
          </button>
        </form>
      </div>
    );
  }

  // 分享链路：始终走服务器反代（不 302）
  const src = `/api/s/${token}/download?preview=1`;
  const dl = `/api/s/${token}/download`;

  return (
    <div className="safe-top safe-bottom mx-auto h-[100dvh] max-h-[100dvh] max-w-4xl overflow-y-auto overscroll-contain px-3 py-5 sm:px-4 sm:py-8">
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-sky-600">
            公开分享
          </div>
          <h1 className="break-all text-lg font-bold text-slate-800 sm:truncate sm:text-xl">{info.fileName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatBytes(info.size)} · {info.kind}
            {info.expiresAt ? ` · 过期 ${new Date(info.expiresAt).toLocaleString("zh-CN")}` : ""}
          </p>
        </div>
        {info.allowDownload && (
          <a
            href={dl}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-teal-400 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-sky-500/20 sm:w-auto sm:py-2"
          >
            <IconDownload className="h-4 w-4" />
            下载
          </a>
        )}
      </div>

      <div className="min-h-[45dvh] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:min-h-[50vh] sm:rounded-3xl sm:p-6">
        {!info.allowPreview ? (
          <div className="flex h-64 flex-col items-center justify-center text-slate-500">
            <p>该分享未开启在线预览</p>
            {info.allowDownload && (
              <a href={dl} className="mt-3 text-sky-600 underline">
                下载文件
              </a>
            )}
          </div>
        ) : info.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={info.fileName} className="mx-auto max-h-[70vh] max-w-full rounded-2xl object-contain" />
        ) : info.kind === "video" ? (
          <MediaPlayer src={src} kind="video" title={info.fileName} size={info.size} />
        ) : info.kind === "audio" ? (
          <div className="flex justify-center py-8">
            <MediaPlayer src={src} kind="audio" title={info.fileName} size={info.size} />
          </div>
        ) : info.kind === "pdf" ? (
          <object
            data={src}
            type="application/pdf"
            title={info.fileName}
            className="h-[70vh] w-full rounded-2xl bg-white"
          >
            <iframe
              src={src}
              title={info.fileName}
              className="h-[70vh] w-full rounded-2xl bg-white"
            />
          </object>
        ) : isText(info.fileName, info.mimeType) ? (
          isMarkdownFile(info.fileName, info.mimeType) && text ? (
            <div
              className="np-md-body max-h-[70vh] overflow-auto rounded-xl bg-white p-4 sm:p-5"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
            />
          ) : (
            <pre className="max-h-[70vh] overflow-auto rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-800">
              <code>{text ?? "加载中…"}</code>
            </pre>
          )
        ) : (
          <div className="flex h-64 flex-col items-center justify-center text-slate-500">
            <p>此类型请下载后查看</p>
            {info.allowDownload && (
              <a href={dl} className="mt-3 text-sky-600 underline">
                下载文件
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
