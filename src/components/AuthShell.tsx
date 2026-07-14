"use client";

import { useEffect, useState } from "react";
import { DriveApp } from "./DriveApp";
import { LoginPage } from "./LoginPage";
import { AdminPage } from "./AdminPage";
import { EnvSetupPage } from "./EnvSetupPage";

type AuthStatus = {
  setupCompleted: boolean;
  siteTitle: string;
  siteDescription: string;
  username: string;
  isLoggedIn: boolean;
  sessionUser: string | null;
  hasApiKey?: boolean;
  hasDatabaseId?: boolean;
  hasNotionConfig?: boolean;
};

export function AuthShell() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"app" | "admin" | "env">("app");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "状态获取失败");
      setStatus(data);
      if (typeof document !== "undefined" && data.siteTitle) {
        document.title = data.siteTitle;
      }
      // 已登录但缺 Notion 配置 → 强制引导配置
      if (data.isLoggedIn && !data.hasNotionConfig && view === "app") {
        setView("env");
      }
      if (data.isLoggedIn && data.hasNotionConfig && view === "env") {
        setView("app");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法连接服务");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
          <span className="text-sm">加载中…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
          <p className="mb-3 font-medium">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
            className="rounded-xl bg-white px-4 py-2 text-sm shadow ring-1 ring-red-200"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!status) return null;

  if (!status.isLoggedIn) {
    return (
      <LoginPage
        setupMode={!status.setupCompleted}
        siteTitle={status.siteTitle}
        onSuccess={() => {
          setLoading(true);
          void refresh();
        }}
      />
    );
  }

  if (view === "admin") {
    return (
      <AdminPage
        siteTitle={status.siteTitle}
        username={status.sessionUser || status.username}
        onBack={() => setView(status.hasNotionConfig ? "app" : "env")}
        onChanged={() => void refresh()}
        onLogout={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          setView("app");
          setLoading(true);
          void refresh();
        }}
      />
    );
  }

  // 已登录但没有 Notion env → 引导配置
  if (!status.hasNotionConfig || view === "env") {
    return (
      <EnvSetupPage
        siteTitle={status.siteTitle}
        onSuccess={() => {
          setLoading(true);
          setView("app");
          void refresh();
        }}
        onOpenAdmin={() => setView("admin")}
      />
    );
  }

  return (
    <DriveApp
      siteTitle={status.siteTitle}
      siteDescription={status.siteDescription}
      username={status.sessionUser || status.username}
      onOpenAdmin={() => setView("admin")}
      onLogout={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        setLoading(true);
        void refresh();
      }}
    />
  );
}
