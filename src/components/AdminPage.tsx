"use client";

import { useEffect, useState } from "react";
import { BtnGhost, BtnPrimary } from "./Dialog";
import {
  IconFolder,
  IconHome,
  IconLogout,
  IconRefresh,
  IconSettings,
  IconUpload,
} from "./icons";

type TabId = "site" | "account" | "env" | "backup" | "index";

type Settings = {
  app: { siteTitle: string; siteDescription: string; username?: string };
  account: { username: string };
  env: Record<string, string>;
  index?: { count?: number; lastSyncAt?: string | null; bootstrapped?: boolean };
};

const TABS: Array<{
  id: TabId;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    id: "site",
    label: "网站信息",
    desc: "标题与描述",
    icon: <IconHome className="h-4 w-4" />,
  },
  {
    id: "account",
    label: "账号密码",
    desc: "登录凭证",
    icon: <IconSettings className="h-4 w-4" />,
  },
  {
    id: "env",
    label: "环境变量",
    desc: "Notion / Session",
    icon: <IconFolder className="h-4 w-4" />,
  },
  {
    id: "index",
    label: "索引同步",
    desc: "SQLite 状态",
    icon: <IconRefresh className="h-4 w-4" />,
  },
  {
    id: "backup",
    label: "备份恢复",
    desc: "导入 / 导出",
    icon: <IconUpload className="h-4 w-4" />,
  },
];

export function AdminPage({
  siteTitle,
  username,
  onBack,
  onChanged,
  onLogout,
}: {
  siteTitle: string;
  username: string;
  onBack: () => void;
  onChanged: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<TabId>("site");
  const [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState(siteTitle);
  const [desc, setDesc] = useState("");
  const [user, setUser] = useState(username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [envKey, setEnvKey] = useState("");
  const [envDb, setEnvDb] = useState("");
  const [envDs, setEnvDs] = useState("");
  const [envSecret, setEnvSecret] = useState("");

  const [indexMeta, setIndexMeta] = useState<Settings["index"]>();

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setTitle(data.app?.siteTitle || "NotionPan");
      setDesc(data.app?.siteDescription || "");
      setUser(data.account?.username || "");
      setEnvKey(data.env?.NOTION_API_KEY || "");
      setEnvDb(data.env?.NOTION_DATABASE_ID || "");
      setEnvDs(data.env?.NOTION_DATA_SOURCE_ID || "");
      setEnvSecret(data.env?.SESSION_SECRET || "");
      setIndexMeta(data.index);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const flash = (ok: string | null, error?: string | null) => {
    setMsg(ok);
    setErr(error || null);
  };

  const saveSite = async () => {
    setBusy(true);
    flash(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteTitle: title, siteDescription: desc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      flash("网站信息已保存");
      onChanged();
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const saveAccount = async () => {
    setBusy(true);
    flash(null);
    try {
      if (!currentPassword) throw new Error("请填写当前密码");
      const body: Record<string, unknown> = {
        currentPassword,
        username: user,
      };
      if (newPassword) body.newPassword = newPassword;
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      flash("账号信息已更新");
      setCurrentPassword("");
      setNewPassword("");
      onChanged();
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const saveEnv = async () => {
    setBusy(true);
    flash(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          env: {
            NOTION_API_KEY: envKey,
            NOTION_DATABASE_ID: envDb,
            NOTION_DATA_SOURCE_ID: envDs,
            SESSION_SECRET: envSecret,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      flash(`环境变量已保存并软加载${data.envSaved?.length ? `：${data.envSaved.join(", ")}` : ""}`);
      onChanged();
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const reloadEnv = async () => {
    setBusy(true);
    flash(null);
    try {
      const res = await fetch("/api/admin/env/reload", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重载失败");
      flash(`已从 .env.local 软加载：${(data.reloaded || []).join(", ") || "无变更"}`);
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "重载失败");
    } finally {
      setBusy(false);
    }
  };

  const syncIndex = async () => {
    setBusy(true);
    flash(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失败");
      flash(`索引已同步：${data.count ?? data.meta?.count ?? 0} 条`);
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = async (withIndex: boolean) => {
    setBusy(true);
    flash(null);
    try {
      const res = await fetch(`/api/admin/backup/export?index=${withIndex ? "1" : "0"}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导出失败");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `notionpan-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash("备份已下载");
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async (file: File) => {
    setBusy(true);
    flash(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await fetch("/api/admin/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");
      flash(data.message || "导入成功");
      onChanged();
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const currentTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50">
      <div className="mx-auto flex min-h-screen max-w-6xl">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white/80 p-4 backdrop-blur md:flex md:flex-col">
          <div className="mb-6 px-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-sky-600">
              Admin
            </div>
            <h1 className="text-lg font-bold text-slate-800">后台设置</h1>
            <p className="mt-0.5 truncate text-xs text-slate-500">{username}</p>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTab(item.id);
                    setMsg(null);
                    setErr(null);
                  }}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    active
                      ? "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow-md shadow-sky-500/20"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      active ? "bg-white/20" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className={`block text-[11px] ${active ? "text-white/80" : "text-slate-400"}`}>
                      {item.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-4 space-y-1 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              ← 返回网盘
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <IconLogout className="h-4 w-4" />
              退出登录
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="rounded-lg border border-slate-200 p-2 text-slate-600 md:hidden"
                onClick={() => setMobileNav((v) => !v)}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-800 sm:text-lg">
                  {currentTab.label}
                </h2>
                <p className="truncate text-xs text-slate-500">{currentTab.desc}</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <BtnGhost onClick={onBack}>返回网盘</BtnGhost>
            </div>
          </header>

          {/* Mobile nav drawer */}
          {mobileNav && (
            <div className="border-b border-slate-200 bg-white px-3 py-2 md:hidden">
              <div className="grid grid-cols-2 gap-1.5">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTab(item.id);
                      setMobileNav(false);
                      setMsg(null);
                      setErr(null);
                    }}
                    className={`rounded-xl px-3 py-2 text-left text-sm ${
                      tab === item.id
                        ? "bg-sky-50 font-medium text-sky-700 ring-1 ring-sky-200"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <main className="flex-1 px-4 py-5 sm:px-6">
            {(msg || err) && (
              <div
                className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
                  err
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}
              >
                {err || msg}
              </div>
            )}

            {loading ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
                加载设置…
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                {tab === "site" && (
                  <Panel
                    title="网站信息"
                    hint="显示在登录页与网盘标题栏"
                    actions={
                      <BtnPrimary onClick={() => void saveSite()} disabled={busy}>
                        {busy ? "保存中…" : "保存"}
                      </BtnPrimary>
                    }
                  >
                    <Field label="网站标题" value={title} onChange={setTitle} />
                    <Field label="副标题 / 描述" value={desc} onChange={setDesc} />
                  </Panel>
                )}

                {tab === "account" && (
                  <Panel
                    title="账号密码"
                    hint="修改用户名或密码时必须填写当前密码"
                    actions={
                      <BtnPrimary onClick={() => void saveAccount()} disabled={busy}>
                        {busy ? "保存中…" : "更新账号"}
                      </BtnPrimary>
                    }
                  >
                    <Field label="用户名" value={user} onChange={setUser} />
                    <Field
                      label="当前密码"
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      type="password"
                      placeholder="必填"
                    />
                    <Field
                      label="新密码"
                      value={newPassword}
                      onChange={setNewPassword}
                      type="password"
                      placeholder="不修改请留空，至少 6 位"
                    />
                  </Panel>
                )}

                {tab === "env" && (
                  <Panel
                    title="环境变量"
                    hint="保存后写入 .env.local 并立即软加载，一般无需重启"
                    actions={
                      <div className="flex flex-wrap gap-2">
                        <BtnGhost onClick={() => void reloadEnv()}>重新加载</BtnGhost>
                        <BtnPrimary onClick={() => void saveEnv()} disabled={busy}>
                          {busy ? "保存中…" : "保存并软加载"}
                        </BtnPrimary>
                      </div>
                    }
                  >
                    <Field
                      label="NOTION_API_KEY"
                      value={envKey}
                      onChange={setEnvKey}
                      placeholder="ntn_...（显示 **** 表示已配置，不改可保留）"
                    />
                    <Field label="NOTION_DATABASE_ID" value={envDb} onChange={setEnvDb} />
                    <Field
                      label="NOTION_DATA_SOURCE_ID（可选）"
                      value={envDs}
                      onChange={setEnvDs}
                      placeholder="可留空自动探测"
                    />
                    <Field
                      label="SESSION_SECRET（≥32 字符，生产建议设置）"
                      value={envSecret}
                      onChange={setEnvSecret}
                      placeholder="随机长字符串"
                    />
                  </Panel>
                )}

                {tab === "index" && (
                  <Panel
                    title="索引同步"
                    hint="列表优先读本地 SQLite，上传/删除会增量更新；可手动全量同步"
                    actions={
                      <BtnPrimary onClick={() => void syncIndex()} disabled={busy}>
                        {busy ? "同步中…" : "全量同步 Notion"}
                      </BtnPrimary>
                    }
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      <StatCard label="索引条数" value={String(indexMeta?.count ?? 0)} />
                      <StatCard
                        label="上次同步"
                        value={
                          indexMeta?.lastSyncAt
                            ? new Date(indexMeta.lastSyncAt).toLocaleString("zh-CN")
                            : "—"
                        }
                      />
                      <StatCard
                        label="状态"
                        value={indexMeta?.bootstrapped ? "已就绪" : "待同步"}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      数据文件：`data/index.sqlite` · 缩略图：`data/thumbs/`
                    </p>
                  </Panel>
                )}

                {tab === "backup" && (
                  <Panel
                    title="备份 / 恢复"
                    hint="导出含账号哈希、站点配置、env、可选 SQLite 索引（不含缩略图文件）"
                  >
                    <div className="flex flex-wrap gap-2">
                      <BtnPrimary onClick={() => void exportBackup(true)} disabled={busy}>
                        导出完整备份
                      </BtnPrimary>
                      <BtnGhost onClick={() => void exportBackup(false)}>仅配置（不含索引）</BtnGhost>
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
                        导入备份
                        <input
                          type="file"
                          accept="application/json,.json"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void importBackup(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                      导入会覆盖当前账号与 env 配置。含索引的备份写入后，建议在「索引同步」页再点一次全量同步以确保一致。
                    </div>
                  </Panel>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
      />
    </label>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}
