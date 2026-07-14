"use client";

import { useState } from "react";

export function LoginPage({
  setupMode,
  siteTitle,
  onSuccess,
}: {
  setupMode: boolean;
  siteTitle: string;
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState(siteTitle || "NotionPan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = setupMode ? "/api/auth/setup" : "/api/auth/login";
      const body = setupMode
        ? { username, password, siteTitle: title }
        : { username, password };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/50 bg-white/90 shadow-2xl shadow-sky-500/10 backdrop-blur">
        <div className="bg-gradient-to-r from-sky-500 via-blue-500 to-teal-400 px-6 py-8 text-white">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-xl font-bold backdrop-blur">
            N
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{siteTitle || "NotionPan"}</h1>
          <p className="mt-1 text-sm text-white/85">
            {setupMode ? "首次使用，请设置管理员账号" : "登录后管理你的 Notion 网盘"}
          </p>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-4 px-6 py-6">
          {setupMode && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">网站标题</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                placeholder="NotionPan"
              />
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">账号</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              placeholder={setupMode ? "设置用户名" : "用户名"}
              required
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={setupMode ? "new-password" : "current-password"}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              placeholder={setupMode ? "至少 6 位" : "密码"}
              required
              minLength={setupMode ? 6 : 1}
            />
          </label>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-teal-400 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:brightness-105 disabled:opacity-60"
          >
            {busy ? "处理中…" : setupMode ? "完成设置并进入" : "登录"}
          </button>

          <p className="text-center text-xs text-slate-400">
            {setupMode
              ? "账号密码保存在服务器 data/app-config.json，仅你自己可见"
              : "会话 Cookie 登录 · 可在后台修改账号与配置"}
          </p>
        </form>
      </div>
    </div>
  );
}
