"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DriveFile, ListFilesResult } from "@/lib/types";
import { formatBytes, formatDate, joinFolder, parentFolder, sanitizeFolder } from "@/lib/utils";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { BtnGhost, BtnPrimary, Dialog, DialogInput } from "./Dialog";
import { FileIcon } from "./FileIcon";
import { PreviewModal } from "./PreviewModal";
import { ThumbImage } from "./ThumbImage";
import {
  IconClose,
  IconDownload,
  IconEdit,
  IconEye,
  IconFolder,
  IconFolderPlus,
  IconGrid,
  IconHome,
  IconList,
  IconLogout,
  IconMove,
  IconOpen,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShare,
  IconTrash,
  IconUpload,
} from "./icons";

type Health = {
  ok: boolean;
  message: string;
  hasApiKey?: boolean;
  hasDatabaseId?: boolean;
};

type CtxTarget =
  | { type: "blank" }
  | { type: "file"; file: DriveFile }
  | { type: "folder"; name: string };

type CtxState = {
  x: number;
  y: number;
  target: CtxTarget;
};

type UploadTask = {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

export function DriveApp({
  siteTitle = "NotionPan",
  siteDescription = "Notion 存储 · 网盘体验",
  username,
  onOpenAdmin,
  onLogout,
}: {
  siteTitle?: string;
  siteDescription?: string;
  username?: string;
  onOpenAdmin?: () => void;
  onLogout?: () => void;
} = {}) {
  const [folder, setFolder] = useState("/");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<DriveFile | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [renameDialog, setRenameDialog] = useState<DriveFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveDialog, setMoveDialog] = useState<DriveFile | null>(null);
  const [moveValue, setMoveValue] = useState("");
  const [allFolders, setAllFolders] = useState<string[]>(["/"]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<DriveFile | null>(null);
  const [shareDialog, setShareDialog] = useState<DriveFile | null>(null);
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpire, setShareExpire] = useState<string>("0");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareList, setShareList] = useState<
    Array<{ token: string; expiresAt: string | null; hasPassword: boolean; accessCount: number }>
  >([]);
  const [viewMode, setViewMode] = useState<"list" | "gallery">("list");
  const [viewReady, setViewReady] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!fabOpen) return;
    const onDown = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setFabOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFabOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [fabOpen]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("notionpan-view");
      if (saved === "gallery" || saved === "list") setViewMode(saved);
    } catch {
      // ignore
    }
    setViewReady(true);
  }, []);

  useEffect(() => {
    if (!viewReady) return;
    try {
      window.localStorage.setItem("notionpan-view", viewMode);
    } catch {
      // ignore
    }
  }, [viewMode, viewReady]);

  const crumbs = useMemo(() => {
    const f = sanitizeFolder(folder);
    if (f === "/") return [{ label: "根目录", path: "/" }];
    const parts = f.split("/").filter(Boolean);
    const items = [{ label: "根目录", path: "/" }];
    let cur = "";
    for (const p of parts) {
      cur += `/${p}`;
      items.push({ label: p, path: cur });
    }
    return items;
  }, [folder]);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      const data = (await res.json()) as Health;
      setHealth(data);
    } catch {
      setHealth({ ok: false, message: "无法连接后端" });
    }
  }, []);

  const loadFiles = useCallback(async (opts?: { refresh?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ folder });
      if (search.trim()) params.set("q", search.trim());
      if (opts?.refresh) params.set("refresh", "1");
      const res = await fetch(`/api/files?${params}`);
      const data = await res.json();
      if (!res.ok) {
        // 展示后端真实错误，便于排查
        throw new Error(data.error || data.message || `加载失败 (${res.status})`);
      }
      const result = data as ListFilesResult;
      setFiles(result.files || []);
      setFolders(result.folders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setFiles([]);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [folder, search]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const uploadFiles = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;

    // 默认服务端上传：密钥不离开服务器
    const { uploadViaServer } = await import("@/lib/client-upload");

    const batch: UploadTask[] = arr.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      name: file.name,
      size: file.size,
      progress: 0,
      status: "pending" as const,
    }));

    setUploadTasks((prev) => [...batch, ...prev].slice(0, 40));
    setUploadPanelOpen(true);
    setUploading(true);
    setUploadPct(0);
    setError(null);

    const patchTask = (id: string, patch: Partial<UploadTask>) => {
      setUploadTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    };

    try {
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        const taskId = batch[i].id;
        patchTask(taskId, { status: "uploading", progress: 0 });

        const report = (pct: number) => {
          patchTask(taskId, { progress: pct });
          const base = (i / arr.length) * 100;
          const part = (pct / 100) * (100 / arr.length);
          setUploadPct(Math.round(base + part));
        };

        try {
          await uploadViaServer(file, folder, report);
          patchTask(taskId, { status: "done", progress: 100 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : `上传失败: ${file.name}`;
          patchTask(taskId, { status: "error", error: msg });
          throw e;
        }
      }
      setUploadPct(100);
      await loadFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      setTimeout(() => setUploadPct(0), 800);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openCreateFolder = () => {
    setFolderName("");
    setFolderDialog(true);
  };

  const openRename = (file: DriveFile) => {
    setRenameDialog(file);
    setRenameValue(file.name);
  };

  const loadAllFolders = async () => {
    setFoldersLoading(true);
    try {
      const res = await fetch("/api/folders");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取文件夹失败");
      const list = Array.isArray(data.folders) ? (data.folders as string[]) : ["/"];
      setAllFolders(list.length ? list : ["/"]);
    } catch {
      setAllFolders(["/"]);
    } finally {
      setFoldersLoading(false);
    }
  };

  const openMove = (file: DriveFile) => {
    setMoveDialog(file);
    setMoveValue(file.folder || "/");
    void loadAllFolders();
  };

  const openDelete = (file: DriveFile) => {
    setDeleteDialog(file);
  };

  const openShare = async (file: DriveFile) => {
    setShareDialog(file);
    setSharePassword("");
    setShareExpire("0");
    setShareUrl(null);
    setDialogBusy(false);
    try {
      const res = await fetch(`/api/share?fileId=${encodeURIComponent(file.id)}`);
      const data = await res.json();
      if (res.ok) setShareList(data.shares || []);
      else setShareList([]);
    } catch {
      setShareList([]);
    }
  };

  const submitShare = async () => {
    if (!shareDialog) return;
    setDialogBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: shareDialog.id,
          password: sharePassword || undefined,
          expiresInHours: shareExpire === "0" ? null : Number(shareExpire),
          allowDownload: true,
          allowPreview: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建分享失败");
      setShareUrl(data.url);
      setShareList((prev) => [data.share, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建分享失败");
    } finally {
      setDialogBusy(false);
    }
  };

  const revokeShare = async (token: string) => {
    if (!confirm("确定撤销该分享链接？")) return;
    try {
      const res = await fetch(`/api/share/${token}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "撤销失败");
      setShareList((prev) => prev.filter((s) => s.token !== token));
      if (shareUrl?.includes(token)) setShareUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "撤销失败");
    }
  };

  const submitDelete = async () => {
    if (!deleteDialog) return;
    setDialogBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${deleteDialog.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      setFiles((prev) => prev.filter((f) => f.id !== deleteDialog.id));
      if (preview?.id === deleteDialog.id) setPreview(null);
      setDeleteDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDialogBusy(false);
    }
  };

  const submitRename = async () => {
    if (!renameDialog) return;
    const name = renameValue.trim();
    if (!name || name === renameDialog.name) {
      setRenameDialog(null);
      return;
    }
    setDialogBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${renameDialog.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重命名失败");
      setFiles((prev) => prev.map((f) => (f.id === renameDialog.id ? data.file : f)));
      if (preview?.id === renameDialog.id) setPreview(data.file);
      setRenameDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重命名失败");
    } finally {
      setDialogBusy(false);
    }
  };

  const submitMove = async () => {
    if (!moveDialog) return;
    const target = sanitizeFolder(moveValue.trim() || "/");
    if (target === sanitizeFolder(moveDialog.folder)) {
      setMoveDialog(null);
      return;
    }
    setDialogBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${moveDialog.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "移动失败");
      if (sanitizeFolder(data.file.folder) !== sanitizeFolder(folder)) {
        setFiles((prev) => prev.filter((f) => f.id !== moveDialog.id));
      } else {
        setFiles((prev) => prev.map((f) => (f.id === moveDialog.id ? data.file : f)));
      }
      setMoveDialog(null);
      await loadFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移动失败");
    } finally {
      setDialogBusy(false);
    }
  };

  const submitCreateFolder = async () => {
    const name = folderName.trim().replace(/[\\/]/g, "");
    if (!name) return;
    setDialogBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent: folder }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建文件夹失败");
      const path = String(data.path || joinFolder(folder, name));
      const base = path.split("/").filter(Boolean).pop() || name;
      setFolders((prev) =>
        prev.includes(base) ? prev : [...prev, base].sort((a, b) => a.localeCompare(b, "zh-CN")),
      );
      setFolderDialog(false);
      setFolderName("");
      await loadFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建文件夹失败");
    } finally {
      setDialogBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
  };

  const openContext = (
    e: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number },
    target: CtxTarget,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, target });
  };

  const longPressFired = useRef(false);

  /** 移动端长按弹出菜单 */
  const bindLongPress = (target: CtxTarget) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;

    return {
      onTouchStart: (e: React.TouchEvent) => {
        longPressFired.current = false;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        timer = setTimeout(() => {
          longPressFired.current = true;
          openContext(
            {
              preventDefault: () => {},
              stopPropagation: () => {},
              clientX: startX,
              clientY: startY,
            },
            target,
          );
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            try {
              navigator.vibrate(12);
            } catch {
              // ignore
            }
          }
        }, 480);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (Math.abs(t.clientX - startX) > 12 || Math.abs(t.clientY - startY) > 12) {
          if (timer) clearTimeout(timer);
          timer = null;
        }
      },
      onTouchEnd: () => {
        if (timer) clearTimeout(timer);
        timer = null;
      },
      onTouchCancel: () => {
        if (timer) clearTimeout(timer);
        timer = null;
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (longPressFired.current) {
          e.preventDefault();
          e.stopPropagation();
          longPressFired.current = false;
        }
      },
    };
  };

  const menuItems: MenuItem[] = useMemo(() => {
    if (!ctx) return [];
    const icon = (node: React.ReactNode) => node;

    if (ctx.target.type === "file") {
      return [
        { id: "preview", label: "预览", icon: icon(<IconEye className="h-4 w-4" />) },
        { id: "download", label: "下载", icon: icon(<IconDownload className="h-4 w-4" />) },
        { id: "share", label: "分享", icon: icon(<IconShare className="h-4 w-4" />) },
        { id: "sep1", label: "", separator: true },
        { id: "rename", label: "重命名", icon: icon(<IconEdit className="h-4 w-4" />) },
        { id: "move", label: "移动到…", icon: icon(<IconMove className="h-4 w-4" />) },
        { id: "sep2", label: "", separator: true },
        { id: "delete", label: "删除", icon: icon(<IconTrash className="h-4 w-4" />), danger: true },
      ];
    }

    if (ctx.target.type === "folder") {
      return [
        { id: "open-folder", label: "打开", icon: icon(<IconOpen className="h-4 w-4" />) },
        { id: "upload-here", label: "上传到此文件夹", icon: icon(<IconUpload className="h-4 w-4" />) },
      ];
    }

    return [
      { id: "upload", label: "上传文件", icon: icon(<IconUpload className="h-4 w-4" />) },
      { id: "new-folder", label: "新建文件夹", icon: icon(<IconFolderPlus className="h-4 w-4" />) },
      { id: "sep3", label: "", separator: true },
      { id: "refresh", label: "刷新", icon: icon(<IconRefresh className="h-4 w-4" />) },
      ...(folder !== "/"
        ? [{ id: "parent", label: "返回上级", icon: icon(<IconHome className="h-4 w-4" />) }]
        : []),
    ];
  }, [ctx, folder]);

  const onMenuSelect = (id: string) => {
    if (!ctx) return;
    const target = ctx.target;

    if (id === "upload" || id === "upload-here") {
      if (target.type === "folder") {
        setFolder(joinFolder(folder, target.name));
        setTimeout(() => fileInputRef.current?.click(), 50);
      } else {
        fileInputRef.current?.click();
      }
      return;
    }
    if (id === "new-folder") {
      openCreateFolder();
      return;
    }
    if (id === "refresh") {
      void loadFiles({ refresh: true });
      return;
    }
    if (id === "parent") {
      setFolder(parentFolder(folder));
      return;
    }
    if (id === "open-folder" && target.type === "folder") {
      setFolder(joinFolder(folder, target.name));
      return;
    }
    if (target.type !== "file") return;

    if (id === "preview") setPreview(target.file);
    if (id === "download") {
      window.location.href = `/api/files/${target.file.id}/download`;
    }
    if (id === "share") void openShare(target.file);
    if (id === "rename") openRename(target.file);
    if (id === "move") openMove(target.file);
    if (id === "delete") openDelete(target.file);
  };

  return (
    <div
      className="mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden px-3 sm:h-auto sm:min-h-screen sm:max-h-none sm:overflow-visible sm:px-6"
      style={{
        // 内联样式，不依赖 CSS 构建缓存；顶部固定留白 + 刘海安全区
        paddingTop: "calc(24px + env(safe-area-inset-top, 0px))",
        paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
      }}
    >
      <header className="mb-3 flex shrink-0 items-center gap-3 sm:mb-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] via-[#6d8fff] to-[var(--accent-2)] text-base font-bold text-white shadow-lg shadow-blue-400/30 sm:h-11 sm:w-11 sm:text-lg">
          N
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate bg-gradient-to-r from-slate-800 via-blue-700 to-teal-600 bg-clip-text text-lg font-bold tracking-tight text-transparent sm:text-2xl">
            {siteTitle}
          </h1>
          <p className="truncate text-xs text-[var(--muted)] sm:text-sm">
            <span className="hidden sm:inline">{siteDescription}</span>
            <span className="sm:hidden">{username || siteDescription}</span>
            {username ? <span className="hidden sm:inline">{` · ${username}`}</span> : ""}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
        />
      </header>

      {health && !health.ok && (
        <div className="mb-2 shrink-0 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:mb-4 sm:px-4 sm:py-3 sm:text-sm">
          <strong>配置检查：</strong> {health.message}
          {!health.hasApiKey || !health.hasDatabaseId
            ? " 请复制 .env.example 为 .env.local 并填写 NOTION_API_KEY / NOTION_DATABASE_ID。"
            : " 请确认 Integration 已连接该数据库，且属性完整。"}
        </div>
      )}

      <div className="mb-2 flex shrink-0 flex-col gap-2.5 sm:mb-4 sm:flex-row sm:items-center sm:gap-3">
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span className="text-[var(--muted)]">/</span>}
              <button
                onClick={() => setFolder(c.path)}
                className={`max-w-[8rem] truncate rounded-md px-1.5 py-1.5 hover:bg-white/80 sm:max-w-[10rem] sm:py-0.5 ${
                  i === crumbs.length - 1 ? "font-semibold text-[var(--text)]" : "text-[var(--muted)]"
                }`}
              >
                {i === 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <IconHome className="h-3.5 w-3.5" />
                    <span className="sm:inline">{c.label}</span>
                  </span>
                ) : (
                  c.label
                )}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="inline-flex shrink-0 rounded-xl border border-[var(--border)] bg-white/90 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs transition sm:py-1.5 ${
                viewMode === "list"
                  ? "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title="列表模式"
            >
              <IconList className="h-3.5 w-3.5" />
              <span className="hidden xs:inline sm:inline">列表</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("gallery")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs transition sm:py-1.5 ${
                viewMode === "gallery"
                  ? "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title="画廊模式（缩略图）"
            >
              <IconGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">画廊</span>
            </button>
          </div>

          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
            }}
          >
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={query}
                onChange={(e) => {
                  const v = e.target.value;
                  setQuery(v);
                  if (!v.trim() && search) setSearch("");
                }}
                placeholder="搜索…"
                className="w-full rounded-xl border border-[var(--border)] bg-white/90 py-2.5 pl-8 pr-8 text-sm shadow-sm outline-none focus:border-[var(--accent)] sm:w-56 sm:py-2"
              />
              {(query || search) && (
                <button
                  type="button"
                  title="清除搜索"
                  onClick={() => {
                    setQuery("");
                    setSearch("");
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="shrink-0 rounded-xl border border-[var(--border)] bg-white/90 px-3 py-2.5 text-sm shadow-sm hover:bg-[var(--panel-2)] sm:py-2"
            >
              搜索
            </button>
          </form>
        </div>
      </div>

      {folder !== "/" && (
        <div className="mb-4">
          <button
            onClick={() => setFolder(parentFolder(folder))}
            className="rounded-lg border border-[var(--border)] bg-white/90 px-2.5 py-1.5 text-xs text-[var(--muted)] shadow-sm hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          >
            ← 上级目录
          </button>
        </div>
      )}

      {search && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 sm:mb-4 sm:px-4 sm:py-2.5 sm:text-sm">
          <span>
            搜索「<strong>{search}</strong>」· 共 {files.length} 个文件
            {folders.length > 0 ? ` · ${folders.length} 个文件夹` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSearch("");
            }}
            className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-sky-700 shadow-sm ring-1 ring-sky-200 hover:bg-sky-100"
          >
            清除并返回列表
          </button>
        </div>
      )}

      {error && (
        <div className="mb-2 shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:mb-4 sm:px-4 sm:py-3 sm:text-sm">
          {error}
        </div>
      )}

      {uploading && (
        <div className="mb-2 h-1.5 shrink-0 overflow-hidden rounded-full bg-blue-100 sm:mb-4">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] transition-all"
            style={{ width: `${uploadPct}%` }}
          />
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onContextMenu={(e) => openContext(e, { type: "blank" })}
        className={`glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] ${
          dragOver ? "ring-2 ring-[var(--accent)] ring-offset-2" : ""
        }`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {loading ? (
          <div className="flex h-full min-h-48 items-center justify-center text-[var(--muted)]">加载中…</div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div
            className="flex h-full min-h-48 cursor-pointer flex-col items-center justify-center gap-2 px-4 text-[var(--muted)]"
            onClick={() => fileInputRef.current?.click()}
            onContextMenu={(e) => openContext(e, { type: "blank" })}
          >
            <div className="rounded-2xl bg-gradient-to-br from-blue-100 to-teal-100 p-4 text-[var(--accent)]">
              <IconUpload className="h-10 w-10" />
            </div>
            <p className="px-4 text-center">点击上传，或拖拽文件到此处</p>
            <p className="text-xs sm:hidden">长按可打开菜单</p>
            <p className="hidden text-xs sm:block">右键可新建文件夹 / 上传</p>
            <p className="text-xs">当前路径：{folder}</p>
          </div>
        ) : viewMode === "gallery" ? (
          <div className="p-2.5 sm:p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
              {folders.map((name) => (
                <button
                  key={`folder-${name}`}
                  type="button"
                  onClick={() => setFolder(joinFolder(folder, name))}
                  onContextMenu={(e) => openContext(e, { type: "folder", name })}
                  {...bindLongPress({ type: "folder", name })}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition active:scale-[0.98] hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                >
                  <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100">
                    <IconFolder className="h-12 w-12 text-amber-500 transition group-hover:scale-105 sm:h-14 sm:w-14" />
                  </div>
                  <div className="truncate px-2.5 py-2 text-sm font-medium text-slate-700 sm:px-3">{name}</div>
                  <div className="px-2.5 pb-2 text-xs text-slate-400 sm:px-3">文件夹</div>
                </button>
              ))}
              {files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setPreview(file)}
                  onContextMenu={(e) => openContext(e, { type: "file", file })}
                  {...bindLongPress({ type: "file", file })}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition active:scale-[0.98] hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                  title={file.name}
                >
                  <ThumbImage
                    id={file.id}
                    kind={file.kind}
                    name={file.name}
                    className="aspect-square w-full"
                  />
                  <div className="truncate px-2.5 py-2 text-sm font-medium text-slate-700 sm:px-3">{file.name}</div>
                  <div className="flex items-center justify-between px-2.5 pb-2 text-xs text-slate-400 sm:px-3">
                    <span>{formatBytes(file.size)}</span>
                    <span className="hidden sm:inline">{file.kind}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* 手机：卡片列表 */}
            <div className="divide-y divide-slate-100 sm:hidden">
              {folders.map((name) => (
                <div
                  key={`m-folder-${name}`}
                  className="flex items-center gap-3 px-3 py-3 active:bg-slate-50"
                  onClick={() => setFolder(joinFolder(folder, name))}
                  onContextMenu={(e) => openContext(e, { type: "folder", name })}
                  {...bindLongPress({ type: "folder", name })}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50">
                    <IconFolder className="h-6 w-6 text-amber-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">{name}</div>
                    <div className="text-xs text-slate-400">文件夹</div>
                  </div>
                </div>
              ))}
              {files.map((file) => (
                <div
                  key={`m-file-${file.id}`}
                  className="flex items-center gap-3 px-3 py-3 active:bg-slate-50"
                  onClick={() => setPreview(file)}
                  onContextMenu={(e) => openContext(e, { type: "file", file })}
                  {...bindLongPress({ type: "file", file })}
                >
                  {file.kind === "image" ? (
                    <ThumbImage
                      id={file.id}
                      kind={file.kind}
                      name={file.name}
                      className="h-11 w-11 shrink-0 rounded-xl"
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[var(--accent)]">
                      <FileIcon kind={file.kind} className="h-6 w-6" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">{file.name}</div>
                    <div className="text-xs text-slate-400">
                      {formatBytes(file.size)} · {formatDate(file.createdTime)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg p-2 text-slate-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      openContext(
                        {
                          preventDefault: () => {},
                          stopPropagation: () => {},
                          clientX: e.clientX,
                          clientY: e.clientY,
                        },
                        { type: "file", file },
                      );
                    }}
                    aria-label="更多"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="19" r="1.5" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* 桌面：表格 */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-gradient-to-r from-white/60 to-[var(--panel-2)]/80 text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-4 py-3 font-medium">名称</th>
                    <th className="px-4 py-3 font-medium">大小</th>
                    <th className="px-4 py-3 font-medium">类型</th>
                    <th className="px-4 py-3 font-medium">上传时间</th>
                    <th className="px-4 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {folders.map((name) => (
                    <tr
                      key={`folder-${name}`}
                      className="border-b border-[var(--border)]/70 hover:bg-blue-50/60"
                      onContextMenu={(e) => openContext(e, { type: "folder", name })}
                      onDoubleClick={() => setFolder(joinFolder(folder, name))}
                    >
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setFolder(joinFolder(folder, name))}
                          className="inline-flex items-center gap-2 font-medium text-teal-700 hover:underline"
                        >
                          <IconFolder className="h-5 w-5 text-amber-500" />
                          {name}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">—</td>
                      <td className="px-4 py-3 text-[var(--muted)]">文件夹</td>
                      <td className="px-4 py-3 text-[var(--muted)]">—</td>
                      <td className="px-4 py-3" />
                    </tr>
                  ))}
                  {files.map((file) => (
                    <tr
                      key={file.id}
                      className="border-b border-[var(--border)]/70 hover:bg-blue-50/60"
                      onContextMenu={(e) => openContext(e, { type: "file", file })}
                      onDoubleClick={() => setPreview(file)}
                    >
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setPreview(file)}
                          className="inline-flex max-w-xs items-center gap-2 truncate text-left hover:text-[var(--accent)] sm:max-w-md"
                          title={file.name}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md">
                            {file.kind === "image" ? (
                              <ThumbImage
                                id={file.id}
                                kind={file.kind}
                                name={file.name}
                                className="h-6 w-6 rounded-md"
                              />
                            ) : (
                              <span className="text-[var(--accent)]">
                                <FileIcon kind={file.kind} className="h-5 w-5" />
                              </span>
                            )}
                          </span>
                          <span className="truncate">{file.name}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">{formatBytes(file.size)}</td>
                      <td className="px-4 py-3 text-[var(--muted)]">{file.kind}</td>
                      <td className="px-4 py-3 text-[var(--muted)]">{formatDate(file.createdTime)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={`/api/files/${file.id}/download`}
                            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white hover:text-[var(--accent)]"
                            title="下载"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <IconDownload className="h-4 w-4" />
                          </a>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openDelete(file);
                            }}
                            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-red-50 hover:text-[var(--danger)]"
                            title="删除"
                          >
                            <IconTrash className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        </div>
      </div>

      <footer className="safe-bottom mt-2 hidden shrink-0 pb-2 text-center text-xs text-[var(--muted)] sm:mt-6 sm:block sm:pb-4">
        右下角菜单 · 右键可管理文件 · 画廊仅加载缩略图
      </footer>

      {/* 移动端底部占位，避免列表被 FAB 挡住 */}
      <div className="h-20 shrink-0 sm:hidden" aria-hidden />

      {/* 右下角悬浮菜单（向上展开） */}
      <div ref={fabRef} className="fab-offset fixed z-40 flex flex-col items-end gap-2">
        {fabOpen && (
          <div className="mb-1 flex flex-col-reverse items-end gap-2">
            {[
              {
                id: "new-folder",
                label: "新建文件夹",
                icon: <IconFolderPlus className="h-4 w-4" />,
                onClick: () => openCreateFolder(),
              },
              {
                id: "upload",
                label: uploading ? `上传中 ${uploadPct}%` : "上传文件",
                icon: <IconUpload className="h-4 w-4" />,
                onClick: () => fileInputRef.current?.click(),
                disabled: uploading,
                primary: true,
              },
              {
                id: "refresh",
                label: "刷新索引",
                icon: <IconRefresh className="h-4 w-4" />,
                onClick: () => void loadFiles({ refresh: true }),
              },
              ...(onOpenAdmin
                ? [
                    {
                      id: "admin",
                      label: "后台",
                      icon: <IconSettings className="h-4 w-4" />,
                      onClick: () => onOpenAdmin(),
                    },
                  ]
                : []),
              ...(onLogout
                ? [
                    {
                      id: "logout",
                      label: "退出",
                      icon: <IconLogout className="h-4 w-4" />,
                      onClick: () => void onLogout(),
                      danger: true,
                    },
                  ]
                : []),
            ].map((item, idx) => (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  item.onClick();
                  setFabOpen(false);
                }}
                 className={`flex items-center gap-2 rounded-full px-3.5 py-2.5 text-sm font-medium shadow-lg transition active:scale-95 hover:scale-[1.02] disabled:opacity-50 sm:py-2 ${
                   item.primary
                     ? "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow-sky-500/30"
                     : item.danger
                       ? "border border-red-100 bg-white text-red-600 shadow-slate-200/80 hover:bg-red-50"
                       : "border border-slate-200 bg-white text-slate-700 shadow-slate-200/80 hover:bg-slate-50"
                 }`}
                 style={{
                   animation: `fab-pop 0.18s ease-out ${idx * 0.03}s both`,
                 }}
               >
                 <span
                   className={`flex h-8 w-8 items-center justify-center rounded-full ${
                     item.primary
                       ? "bg-white/20"
                       : item.danger
                         ? "bg-red-50"
                         : "bg-slate-100 text-slate-600"
                   }`}
                 >
                   {item.icon}
                 </span>
                 <span className="max-w-[40vw] truncate sm:max-w-none">{item.label}</span>
               </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setFabOpen((v) => !v)}
          className={`flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl transition-all ${
            fabOpen
              ? "rotate-45 bg-slate-700 shadow-slate-400/40"
              : "bg-gradient-to-br from-sky-500 via-blue-500 to-teal-400 shadow-sky-500/40 hover:scale-105"
          }`}
          title={fabOpen ? "关闭菜单" : "打开菜单"}
          aria-expanded={fabOpen}
        >
          {fabOpen ? <IconClose className="h-6 w-6" /> : <IconPlus className="h-7 w-7" />}
        </button>
      </div>

      {/* 上传任务列表 */}
      {(uploadPanelOpen || uploadTasks.length > 0) && (
        <div className="upload-panel-offset fixed z-40 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/40 sm:w-[min(100vw-2rem,22rem)]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-sky-50 to-teal-50 px-3 py-2">
            <button
              type="button"
              className="text-left text-sm font-semibold text-slate-800"
              onClick={() => setUploadPanelOpen((v) => !v)}
            >
              上传列表
              {uploading ? (
                <span className="ml-2 text-xs font-normal text-sky-600">进行中 {uploadPct}%</span>
              ) : (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {uploadTasks.filter((t) => t.status === "done").length}/{uploadTasks.length}
                </span>
              )}
            </button>
            <div className="flex items-center gap-1">
              {!uploading && uploadTasks.length > 0 && (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white"
                  onClick={() => {
                    setUploadTasks([]);
                    setUploadPanelOpen(false);
                  }}
                >
                  清空
                </button>
              )}
              <button
                type="button"
                className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600"
                onClick={() => setUploadPanelOpen((v) => !v)}
                title={uploadPanelOpen ? "收起" : "展开"}
              >
                <IconClose className={`h-3.5 w-3.5 transition ${uploadPanelOpen ? "" : "rotate-45"}`} />
              </button>
            </div>
          </div>

          {uploadPanelOpen && (
            <div className="max-h-64 space-y-2 overflow-auto p-2">
              {uploadTasks.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-slate-400">暂无上传任务</div>
              ) : (
                uploadTasks.map((t) => (
                  <div key={t.id} className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-slate-800" title={t.name}>
                          {t.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{formatBytes(t.size)}</div>
                      </div>
                      <span
                        className={`shrink-0 text-[11px] font-medium ${
                          t.status === "done"
                            ? "text-emerald-600"
                            : t.status === "error"
                              ? "text-red-500"
                              : t.status === "uploading"
                                ? "text-sky-600"
                                : "text-slate-400"
                        }`}
                      >
                        {t.status === "done"
                          ? "完成"
                          : t.status === "error"
                            ? "失败"
                            : t.status === "uploading"
                              ? `${t.progress}%`
                              : "等待"}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full transition-all ${
                          t.status === "error"
                            ? "bg-red-400"
                            : t.status === "done"
                              ? "bg-emerald-500"
                              : "bg-gradient-to-r from-sky-500 to-teal-400"
                        }`}
                        style={{
                          width: `${t.status === "done" ? 100 : t.status === "error" ? 100 : t.progress}%`,
                        }}
                      />
                    </div>
                    {t.error && (
                      <div className="mt-1 truncate text-[11px] text-red-500" title={t.error}>
                        {t.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={menuItems}
          onSelect={onMenuSelect}
          onClose={() => setCtx(null)}
        />
      )}

      <Dialog
        open={folderDialog}
        title="新建文件夹"
        description={`将在 ${folder} 下创建`}
        onClose={() => !dialogBusy && setFolderDialog(false)}
        footer={
          <>
            <BtnGhost onClick={() => setFolderDialog(false)}>取消</BtnGhost>
            <BtnPrimary onClick={() => void submitCreateFolder()} disabled={dialogBusy || !folderName.trim()}>
              {dialogBusy ? "创建中…" : "创建"}
            </BtnPrimary>
          </>
        }
      >
        <DialogInput
          label="文件夹名称"
          value={folderName}
          onChange={setFolderName}
          placeholder="例如 docs"
          autoFocus
          onEnter={() => void submitCreateFolder()}
        />
      </Dialog>

      <Dialog
        open={Boolean(renameDialog)}
        title="重命名"
        description={renameDialog ? `原名称：${renameDialog.name}` : undefined}
        onClose={() => !dialogBusy && setRenameDialog(null)}
        footer={
          <>
            <BtnGhost onClick={() => setRenameDialog(null)}>取消</BtnGhost>
            <BtnPrimary onClick={() => void submitRename()} disabled={dialogBusy || !renameValue.trim()}>
              {dialogBusy ? "保存中…" : "保存"}
            </BtnPrimary>
          </>
        }
      >
        <DialogInput
          label="新名称"
          value={renameValue}
          onChange={setRenameValue}
          autoFocus
          onEnter={() => void submitRename()}
        />
      </Dialog>

      <Dialog
        open={Boolean(moveDialog)}
        title="移动到…"
        description={
          moveDialog
            ? `文件「${moveDialog.name}」· 当前位置 ${moveDialog.folder}`
            : undefined
        }
        onClose={() => !dialogBusy && setMoveDialog(null)}
        wide
        footer={
          <>
            <BtnGhost onClick={() => setMoveDialog(null)}>取消</BtnGhost>
            <BtnPrimary onClick={() => void submitMove()} disabled={dialogBusy || !moveValue.trim()}>
              {dialogBusy ? "移动中…" : "移动到此处"}
            </BtnPrimary>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">选择目标文件夹</span>
            <button
              type="button"
              onClick={() => void loadAllFolders()}
              className="text-xs text-blue-600 hover:underline"
              disabled={foldersLoading}
            >
              {foldersLoading ? "刷新中…" : "刷新目录"}
            </button>
          </div>

          <div className="max-h-56 space-y-1 overflow-auto rounded-xl border border-slate-200 bg-slate-50/80 p-2">
            {foldersLoading && allFolders.length <= 1 ? (
              <div className="px-2 py-6 text-center text-sm text-slate-500">加载文件夹…</div>
            ) : (
              allFolders.map((path) => {
                const selected = sanitizeFolder(moveValue) === sanitizeFolder(path);
                const depth = path === "/" ? 0 : path.split("/").filter(Boolean).length - 1;
                const label = path === "/" ? "根目录 /" : path.split("/").filter(Boolean).pop() || path;
                return (
                  <button
                    key={path}
                    type="button"
                    onClick={() => setMoveValue(path)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      selected
                        ? "bg-gradient-to-r from-blue-500 to-teal-400 text-white shadow-md shadow-blue-500/20"
                        : "bg-white text-slate-700 hover:bg-blue-50"
                    }`}
                    style={{ paddingLeft: `${10 + depth * 14}px` }}
                  >
                    <IconFolder className={`h-4 w-4 shrink-0 ${selected ? "text-white" : "text-amber-500"}`} />
                    <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                    <span className={`shrink-0 text-xs ${selected ? "text-white/80" : "text-slate-400"}`}>
                      {path}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <DialogInput
            label="或手动输入路径"
            value={moveValue}
            onChange={setMoveValue}
            placeholder="/ 或 /docs/images"
            onEnter={() => void submitMove()}
          />
          <p className="text-xs text-slate-500">
            已选：
            <span className="ml-1 font-medium text-slate-700">{sanitizeFolder(moveValue || "/")}</span>
          </p>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleteDialog)}
        title="确认删除"
        description={
          deleteDialog
            ? `确定删除「${deleteDialog.name}」？会在 Notion 中归档该页面。`
            : undefined
        }
        onClose={() => !dialogBusy && setDeleteDialog(null)}
        footer={
          <>
            <BtnGhost onClick={() => setDeleteDialog(null)}>取消</BtnGhost>
            <BtnPrimary danger onClick={() => void submitDelete()} disabled={dialogBusy}>
              {dialogBusy ? "删除中…" : "删除"}
            </BtnPrimary>
          </>
        }
      />

      <Dialog
        open={Boolean(shareDialog)}
        title="分享文件"
        description={shareDialog ? `「${shareDialog.name}」` : undefined}
        onClose={() => !dialogBusy && setShareDialog(null)}
        wide
        footer={
          <>
            <BtnGhost onClick={() => setShareDialog(null)}>关闭</BtnGhost>
            <BtnPrimary onClick={() => void submitShare()} disabled={dialogBusy}>
              {dialogBusy ? "生成中…" : "生成链接"}
            </BtnPrimary>
          </>
        }
      >
        <div className="space-y-4">
          <DialogInput
            label="访问密码（可选）"
            value={sharePassword}
            onChange={setSharePassword}
            placeholder="留空则任何人可打开"
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">有效期</span>
            <select
              value={shareExpire}
              onChange={(e) => setShareExpire(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            >
              <option value="0">永久有效</option>
              <option value="1">1 小时</option>
              <option value="24">1 天</option>
              <option value="168">7 天</option>
              <option value="720">30 天</option>
            </select>
          </label>

          {shareUrl && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="mb-1 text-xs font-medium text-emerald-800">分享链接已生成</div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all text-xs text-emerald-900">{shareUrl}</code>
                <button
                  type="button"
                  className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
                  onClick={() => {
                    void navigator.clipboard.writeText(shareUrl);
                  }}
                >
                  复制
                </button>
              </div>
            </div>
          )}

          {shareList.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">已有分享</div>
              <div className="max-h-40 space-y-2 overflow-auto">
                {shareList.map((s) => (
                  <div
                    key={s.token}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-slate-600">/s/{s.token.slice(0, 10)}…</div>
                      <div className="text-slate-400">
                        {s.hasPassword ? "有密码 · " : ""}
                        {s.expiresAt
                          ? `过期 ${new Date(s.expiresAt).toLocaleString("zh-CN")}`
                          : "永久"}
                        {` · 访问 ${s.accessCount ?? 0} 次`}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded-md bg-white px-2 py-1 text-sky-600 ring-1 ring-slate-200"
                        onClick={() => {
                          const url = `${window.location.origin}/s/${s.token}`;
                          void navigator.clipboard.writeText(url);
                          setShareUrl(url);
                        }}
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-white px-2 py-1 text-red-600 ring-1 ring-slate-200"
                        onClick={() => void revokeShare(s.token)}
                      >
                        撤销
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
