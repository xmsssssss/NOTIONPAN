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

type TabId = "site" | "account" | "env" | "webdav" | "backup" | "index";

type Settings = {
  app: {
    siteTitle: string;
    siteDescription: string;
    username?: string;
    autoPlay?: boolean;
    siteIcon?: string;
  };
  account: { username: string };
  env: Record<string, string>;
  index?: {
    count?: number;
    lastSyncAt?: string | null;
    bootstrapped?: boolean;
    backend?: string | null;
  };
  webdav?: {
    path: string;
    mountUrl: string;
    auth: string;
    username: string;
    proxyDownload: boolean;
    publicUrl: string;
  };
};

const TABS: Array<{
  id: TabId;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    id: "site",
    label: "网站设置",
    icon: <IconHome className="h-4 w-4" />,
  },
  {
    id: "account",
    label: "账号密码",
    icon: <IconSettings className="h-4 w-4" />,
  },
  {
    id: "env",
    label: "环境变量",
    icon: <IconFolder className="h-4 w-4" />,
  },
  {
    id: "webdav",
    label: "WebDAV",
    icon: <IconUpload className="h-4 w-4" />,
  },
  {
    id: "index",
    label: "索引同步",
    icon: <IconRefresh className="h-4 w-4" />,
  },
  {
    id: "backup",
    label: "备份恢复",
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
  const [autoPlay, setAutoPlay] = useState(true);
  const [siteIcon, setSiteIcon] = useState("N");
  const [user, setUser] = useState(username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [envKey, setEnvKey] = useState("");
  const [envDb, setEnvDb] = useState("");
  const [envDs, setEnvDs] = useState("");
  const [envSecret, setEnvSecret] = useState("");
  const [envWebhook, setEnvWebhook] = useState("");

  const [indexMeta, setIndexMeta] = useState<Settings["index"]>();
  const [webdavMountUrl, setWebdavMountUrl] = useState("");
  const [webdavProxy, setWebdavProxy] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setTitle(data.app?.siteTitle || "NotionPan");
      setDesc(data.app?.siteDescription || "");
      setAutoPlay(data.app?.autoPlay !== false);
      setSiteIcon((data.app?.siteIcon || "N").slice(0, 2) || "N");
      setUser(data.account?.username || "");
      setEnvKey(data.env?.NOTION_API_KEY || "");
      setEnvDb(data.env?.NOTION_DATABASE_ID || "");
      setEnvDs(data.env?.NOTION_DATA_SOURCE_ID || "");
      setEnvWebhook(data.env?.NOTION_WEBHOOK_TOKEN || "");
      setEnvSecret(data.env?.SESSION_SECRET || "");
      setIndexMeta(data.index);
      setWebdavMountUrl(data.webdav?.mountUrl || "");
      setWebdavProxy(Boolean(data.webdav?.proxyDownload));
      setPublicUrl(
        data.webdav?.publicUrl ||
          data.env?.PUBLIC_URL ||
          "",
      );
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
        body: JSON.stringify({
          siteTitle: title,
          siteDescription: desc,
          autoPlay,
          siteIcon,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      flash("网站设置已保存");
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
            NOTION_WEBHOOK_TOKEN: envWebhook,
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

  const saveWebdav = async () => {
    setBusy(true);
    flash(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          env: {
            PUBLIC_URL: publicUrl.trim(),
            WEBDAV_PROXY_DOWNLOAD: webdavProxy ? "1" : "0",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      if (data.webdav?.mountUrl) setWebdavMountUrl(data.webdav.mountUrl);
      setWebdavProxy(Boolean(data.webdav?.proxyDownload));
      flash("WebDAV 设置已保存");
      onChanged();
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string) => {
    const { copyTextToClipboard } = await import("@/lib/client-file");
    const ok = await copyTextToClipboard(text);
    if (ok) flash("已复制到剪贴板");
    else flash(null, "复制失败，请手动选择复制");
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

  const repairSchema = async () => {
    setBusy(true);
    flash(null);
    try {
      const res = await fetch("/api/admin/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repair" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "修复失败");
      flash(
        data.message ||
          (data.repaired?.length
            ? `已补全：${data.repaired.join(", ")}`
            : "Schema 正常"),
      );
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "修复失败");
    } finally {
      setBusy(false);
    }
  };

  const createDatabase = async () => {
    const parentPageId = window.prompt(
      "可选：父页面 ID（32 位）。留空则尝试在工作区根创建。\n请先把 Integration 加到该页面。",
      "",
    );
    if (parentPageId === null) return;
    setBusy(true);
    flash(null);
    try {
      const res = await fetch("/api/admin/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          parentPageId: parentPageId.trim() || undefined,
          title: "NotionPan",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "创建失败");
      flash(
        `已创建数据库 ${data.created?.databaseId || ""}，环境变量已写入`,
      );
      onChanged();
      await load();
    } catch (e) {
      flash(null, e instanceof Error ? e.message : "创建失败");
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
    const ok = window.confirm(
      `确定导入备份「${file.name}」？\n\n将覆盖当前管理员账号、站点配置与环境变量；若备份含索引也会覆盖本地索引。此操作不可撤销。`,
    );
    if (!ok) return;

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
    <div className="safe-top safe-bottom h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain bg-gradient-to-br from-slate-50 via-white to-sky-50">
      <div className="mx-auto flex min-h-full max-w-6xl">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white/80 p-4 backdrop-blur md:flex md:flex-col">
          <div className="mb-6 px-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-sky-600">
              管理
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
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-4 space-y-1 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              ← 返回网盘
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
            >
              <IconLogout className="h-4 w-4" />
              退出登录
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-200/80 bg-white/95 px-3 py-2.5 backdrop-blur sm:gap-3 sm:px-6 sm:py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              {/* 手机：左侧直接返回网盘 */}
              <button
                type="button"
                onClick={onBack}
                className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-2.5 text-sm font-medium text-sky-700 active:bg-sky-100 md:hidden"
                aria-label="返回网盘"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M15 18 9 12l6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                网盘
              </button>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-800 sm:text-lg">
                  {currentTab.label}
                </h2>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={onBack}
                className="hidden rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 active:bg-slate-50 md:inline-flex"
              >
                返回网盘
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-medium text-red-600 active:bg-red-50 sm:text-sm"
              >
                退出
              </button>
            </div>
          </header>

          {/* Mobile nav: horizontal scroll chips */}
          <div className="border-b border-slate-100 bg-white px-2 py-2 md:hidden">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                  className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-medium transition ${
                    tab === item.id
                      ? "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile expanded nav (hamburger) */}
          {mobileNav && (
            <div className="border-b border-slate-200 bg-white px-3 py-3 md:hidden">
              <div className="grid grid-cols-1 gap-1.5">
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
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${
                      tab === item.id
                        ? "bg-sky-50 font-medium text-sky-700 ring-1 ring-sky-200"
                        : "text-slate-600 active:bg-slate-50"
                    }`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <main className="flex-1 px-3 py-4 sm:px-6 sm:py-5">
            {(msg || err) && (
              <div
                className={`mb-3 rounded-xl border px-3 py-2.5 text-sm sm:mb-4 sm:px-4 sm:py-3 ${
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
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                {tab === "site" && (
                  <Panel
                    title="网站设置"
                    hint="标题、图标与媒体播放行为"
                    actions={
                      <BtnPrimary onClick={() => void saveSite()} disabled={busy}>
                        {busy ? "保存中…" : "保存"}
                      </BtnPrimary>
                    }
                  >
                    <Field label="网站标题" value={title} onChange={setTitle} />
                    <Field label="副标题 / 描述" value={desc} onChange={setDesc} />
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">网站图标</span>
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] via-[#6d8fff] to-[var(--accent-2)] text-base font-bold text-white shadow-lg shadow-blue-400/30">
                          {(siteIcon || "N").slice(0, 2)}
                        </div>
                        <input
                          value={siteIcon}
                          onChange={(e) => setSiteIcon(e.target.value.slice(0, 2))}
                          maxLength={2}
                          className="w-20 rounded-xl border border-slate-200 px-3 py-2.5 text-center text-lg font-semibold outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                          placeholder="N"
                        />
                        <span className="text-xs text-slate-400">1～2 个字符，显示在顶栏</span>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={autoPlay}
                        onChange={(e) => setAutoPlay(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-700">媒体自动播放</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          开启后，预览视频 / 音频时自动开始播放
                        </span>
                      </span>
                    </label>
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
                    hint="保存后写入 .env.local 并立即软加载"
                    actions={
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <BtnGhost onClick={() => void reloadEnv()}>重新加载</BtnGhost>
                        <BtnPrimary onClick={() => void saveEnv()} disabled={busy}>
                          {busy ? "保存中…" : "保存并软加载"}
                        </BtnPrimary>
                      </div>
                    }
                  >
                    <Field
                      label="Notion 访问令牌"
                      value={envKey}
                      onChange={setEnvKey}
                      placeholder="ntn_...（显示 **** 表示已配置）"
                    />
                    <Field
                      label="Notion 数据库 ID"
                      value={envDb}
                      onChange={setEnvDb}
                      placeholder="约 32 位字符"
                    />
                    <Field
                      label="数据源 ID（可选）"
                      value={envDs}
                      onChange={setEnvDs}
                      placeholder="可留空，程序会自动探测"
                    />
                    <Field
                      label="会话密钥（≥32 字符）"
                      value={envSecret}
                      onChange={setEnvSecret}
                      placeholder="随机长字符串，生产务必修改"
                    />
                    <Field
                      label="Webhook 校验令牌（可选）"
                      value={envWebhook}
                      onChange={setEnvWebhook}
                      placeholder="Notion 订阅验证后自动写入，也可手动粘贴"
                    />
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Webhook（需公网 HTTPS）：
                      <code className="mx-0.5 rounded bg-slate-100 px-1">
                        /api/webhooks/notion
                      </code>
                      。建议订阅{" "}
                      <code className="rounded bg-slate-100 px-1">file_upload.*</code>
                      {" + "}
                      <code className="rounded bg-slate-100 px-1">page.created/deleted/properties_updated</code>
                      。未配置时外链仍轮询；页面变更需手动「刷新索引」。
                    </p>
                  </Panel>
                )}

                {tab === "webdav" && (
                  <Panel
                    title="WebDAV 挂载"
                    hint="用资源管理器 / Cyberduck / RaiDrive 等挂载网盘"
                    actions={
                      <BtnPrimary onClick={() => void saveWebdav()} disabled={busy}>
                        {busy ? "保存中…" : "保存 WebDAV 设置"}
                      </BtnPrimary>
                    }
                  >
                    <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-3 text-sm text-slate-700">
                      <div className="text-xs font-medium text-sky-800">挂载地址</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <code className="break-all rounded-lg bg-white px-2 py-1 text-xs text-slate-800 ring-1 ring-sky-100">
                          {webdavMountUrl ||
                            (typeof window !== "undefined"
                              ? `${window.location.origin}/webdav/`
                              : "/webdav/")}
                        </code>
                        <button
                          type="button"
                          className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50"
                          onClick={() =>
                            void copyText(
                              webdavMountUrl ||
                                (typeof window !== "undefined"
                                  ? `${window.location.origin}/webdav/`
                                  : "/webdav/"),
                            )
                          }
                        >
                          复制
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        认证：HTTP Basic · 用户名/密码与站点管理员相同（
                        <span className="font-medium text-slate-700">{user || username}</span>
                        ）。OpenList / Cyberduck 等填完整 URL（含{" "}
                        <code className="rounded bg-white px-1">/webdav/</code>
                        ）。
                      </p>
                    </div>

                    <Field
                      label="对外访问地址 PUBLIC_URL（可选）"
                      value={publicUrl}
                      onChange={setPublicUrl}
                      placeholder="https://pan.example.com 或 http://IP:3000"
                    />
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      用于生成正确的挂载/分享链接。Docker 或反代时建议填写，避免出现{" "}
                      <code className="rounded bg-slate-100 px-1">0.0.0.0</code>。
                    </p>

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-600">下载方式</div>
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <input
                          type="radio"
                          name="webdav-dl"
                          className="mt-1"
                          checked={!webdavProxy}
                          onChange={() => setWebdavProxy(false)}
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-800">
                            302 跳转 Notion（推荐）
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            本机不中转文件流量，省带宽；部分老旧 WebDAV 客户端可能不跟随跳转
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <input
                          type="radio"
                          name="webdav-dl"
                          className="mt-1"
                          checked={webdavProxy}
                          onChange={() => setWebdavProxy(true)}
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-800">
                            本机反代（兼容优先）
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            返回 200 文件流，兼容性更好；流量经过服务器
                          </span>
                        </span>
                      </label>
                    </div>

                    <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
                      已支持：列目录、上传下载、删、建夹、移动/复制文件与文件夹；反代模式下支持
                      Range。仍不支持 LOCK；单文件大小受 Notion 套餐限制；复制会重新下载再上传。
                    </div>
                  </Panel>
                )}

                {tab === "index" && (
                  <Panel
                    title="索引同步"
                    hint="列表优先读本地索引；可手动全量同步。配置 Webhook 后 Notion 内改动能增量更新。"
                    actions={
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                        <BtnGhost onClick={() => void repairSchema()} disabled={busy}>
                          修复 Schema
                        </BtnGhost>
                        <BtnGhost onClick={() => void createDatabase()} disabled={busy}>
                          自动建库
                        </BtnGhost>
                        <BtnPrimary onClick={() => void syncIndex()} disabled={busy}>
                          {busy ? "同步中…" : "全量同步 Notion"}
                        </BtnPrimary>
                      </div>
                    }
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
                      <StatCard label="索引条数" value={String(indexMeta?.count ?? 0)} />
                      <StatCard
                        label="存储后端"
                        value={
                          indexMeta?.backend === "sqlite"
                            ? "SQLite 数据库"
                            : indexMeta?.backend === "json"
                              ? "JSON 文件"
                              : "—"
                        }
                      />
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
                    <p className="break-words text-xs leading-relaxed text-slate-500">
                      优先使用 SQLite 本地库，否则回退为 JSON 索引文件。缩略图缓存在服务器
                      data/thumbs/ 目录。
                    </p>
                  </Panel>
                )}

                {tab === "backup" && (
                  <Panel
                    title="备份 / 恢复"
                    hint="导出含账号、站点配置、env、可选本地索引"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <BtnPrimary onClick={() => void exportBackup(true)} disabled={busy}>
                        导出完整备份
                      </BtnPrimary>
                      <BtnGhost onClick={() => void exportBackup(false)}>仅配置</BtnGhost>
                      <label className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 active:bg-slate-50 sm:w-auto sm:py-2">
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
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 sm:px-4 sm:py-3">
                      导入会覆盖当前账号与 env。含索引的备份写入后，建议再点一次全量同步。
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
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          {hint && <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>}
        </div>
        {actions && (
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            {actions}
          </div>
        )}
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
