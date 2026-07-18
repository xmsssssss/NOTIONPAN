"use client";

import { useCallback, useEffect, useState } from "react";
import { DriveApp } from "./DriveApp";
import { LoginPage, type LoginSuccessPayload } from "./LoginPage";
import { AdminPage } from "./AdminPage";
import { EnvSetupPage } from "./EnvSetupPage";

type AuthStatus = {
  setupCompleted: boolean;
  siteTitle: string;
  siteDescription: string;
  username: string;
  isLoggedIn: boolean;
  sessionUser: string | null;
  autoPlay?: boolean;
  siteIcon?: string;
  hasApiKey?: boolean;
  hasDatabaseId?: boolean;
  hasNotionConfig?: boolean;
};

export function AuthShell() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"app" | "admin" | "env">("app");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/status", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "状态获取失败");
      setStatus(data);
      if (typeof document !== "undefined" && data.siteTitle) {
        document.title = data.siteTitle;
      }
      if (data.isLoggedIn && !data.hasNotionConfig) {
        setView((v) => (v === "admin" ? v : "env"));
      } else if (data.isLoggedIn && data.hasNotionConfig) {
        setView((v) => (v === "env" ? "app" : v));
      }
      return data as AuthStatus;
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法连接服务");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onLoginSuccess = async (payload?: LoginSuccessPayload) => {
    // 先用登录接口返回的数据立刻切界面，避免 Cookie 尚未生效时 status 仍显示未登录
    if (payload?.isLoggedIn) {
      setStatus((prev) => ({
        setupCompleted: payload.setupCompleted ?? prev?.setupCompleted ?? true,
        siteTitle: payload.siteTitle || prev?.siteTitle || "NotionPan",
        siteDescription: payload.siteDescription || prev?.siteDescription || "",
        username: payload.username || payload.sessionUser || prev?.username || "",
        isLoggedIn: true,
        sessionUser: payload.sessionUser || payload.username || null,
        autoPlay: prev?.autoPlay,
        siteIcon: prev?.siteIcon,
        hasApiKey: prev?.hasApiKey,
        hasDatabaseId: prev?.hasDatabaseId,
        hasNotionConfig: prev?.hasNotionConfig,
      }));
      setLoading(false);
    } else {
      setLoading(true);
    }

    // 再拉一次完整状态（含 hasNotionConfig）
    const data = await refresh();
    if (data?.isLoggedIn && !data.hasNotionConfig) {
      setView("env");
    } else if (data?.isLoggedIn) {
      setView("app");
    } else if (payload?.isLoggedIn) {
      // Cookie 可能因 Secure 未写入：提示并硬刷新一次
      setError(
        "登录成功但会话未生效（常见于 production + HTTP）。请设置 COOKIE_SECURE=0 后重启，或使用 HTTPS。",
      );
    }
  };

  if (loading && !status) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
          <span className="text-sm">加载中…</span>
        </div>
      </div>
    );
  }

  if (error && !status?.isLoggedIn) {
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
        onSuccess={(data) => {
          void onLoginSuccess(data);
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
          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
          setView("app");
          setLoading(true);
          void refresh();
        }}
      />
    );
  }

  if (!status.hasNotionConfig || view === "env") {
    return (
      <EnvSetupPage
        siteTitle={status.siteTitle}
        onSuccess={() => {
          setView("app");
          void refresh();
        }}
        onOpenAdmin={() => setView("admin")}
      />
    );
  }

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden">
      {error && (
        <div className="shrink-0 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">{error}</div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <DriveApp
          siteTitle={status.siteTitle}
          siteDescription={status.siteDescription}
          username={status.sessionUser || status.username}
          siteIcon={status.siteIcon}
          autoPlay={status.autoPlay !== false}
          onOpenAdmin={() => setView("admin")}
          onLogout={async () => {
            await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
            setLoading(true);
            void refresh();
          }}
        />
      </div>
    </div>
  );
}
