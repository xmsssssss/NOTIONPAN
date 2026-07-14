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
      if (!res.ok) throw new Error(data.error || "加载失败");
      const result = data as ListFilesResult;
      setFiles(result.files);
      setFolders(result.folders);
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
    setUploading(true);
    setUploadPct(0);
    setError(null);

    try {
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const form = new FormData();
          form.append("file", file);
          form.append("folder", folder);

          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              const base = (i / arr.length) * 100;
              const part = (ev.loaded / ev.total) * (100 / arr.length);
              setUploadPct(Math.round(base + part));
            }
          };
          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText || "{}");
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else reject(new Error(data.error || `上传失败: ${file.name}`));
            } catch {
              reject(new Error(`上传失败: ${file.name}`));
            }
          };
          xhr.onerror = () => reject(new Error(`网络错误: ${file.name}`));
          xhr.open("POST", "/api/files");
          xhr.send(form);
        });
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

  const openContext = (e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, target });
  };

  const menuItems: MenuItem[] = useMemo(() => {
    if (!ctx) return [];
    const icon = (node: React.ReactNode) => node;

    if (ctx.target.type === "file") {
      return [
        { id: "preview", label: "预览", icon: icon(<IconEye className="h-4 w-4" />) },
        { id: "download", label: "下载", icon: icon(<IconDownload className="h-4 w-4" />) },
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
    if (id === "rename") openRename(target.file);
    if (id === "move") openMove(target.file);
    if (id === "delete") openDelete(target.file);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] via-[#6d8fff] to-[var(--accent-2)] text-lg font-bold text-white shadow-lg shadow-blue-400/30">
          N
        </div>
        <div className="min-w-0">
          <h1 className="truncate bg-gradient-to-r from-slate-800 via-blue-700 to-teal-600 bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">
            {siteTitle}
          </h1>
          <p className="truncate text-xs text-[var(--muted)] sm:text-sm">
            {siteDescription}
            {username ? ` · ${username}` : ""}
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
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>配置检查：</strong> {health.message}
          {!health.hasApiKey || !health.hasDatabaseId
            ? " 请复制 .env.example 为 .env.local 并填写 NOTION_API_KEY / NOTION_DATABASE_ID。"
            : " 请确认 Integration 已连接该数据库，且属性完整。"}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-[var(--muted)]">/</span>}
              <button
                onClick={() => setFolder(c.path)}
                className={`max-w-[10rem] truncate rounded-md px-1.5 py-0.5 hover:bg-white/80 ${
                  i === crumbs.length - 1 ? "font-semibold text-[var(--text)]" : "text-[var(--muted)]"
                }`}
              >
                {i === 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <IconHome className="h-3.5 w-3.5" />
                    {c.label}
                  </span>
                ) : (
                  c.label
                )}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-[var(--border)] bg-white/90 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition ${
                viewMode === "list"
                  ? "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title="列表模式"
            >
              <IconList className="h-3.5 w-3.5" />
              列表
            </button>
            <button
              type="button"
              onClick={() => setViewMode("gallery")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition ${
                viewMode === "gallery"
                  ? "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title="画廊模式（缩略图）"
            >
              <IconGrid className="h-3.5 w-3.5" />
              画廊
            </button>
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
            }}
          >
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={query}
                onChange={(e) => {
                  const v = e.target.value;
                  setQuery(v);
                  // 清空输入后立即回到原列表
                  if (!v.trim() && search) setSearch("");
                }}
                placeholder="搜索文件/文件夹…"
                className="w-48 rounded-xl border border-[var(--border)] bg-white/90 py-2 pl-8 pr-8 text-sm shadow-sm outline-none focus:border-[var(--accent)] sm:w-56"
              />
              {(query || search) && (
                <button
                  type="button"
                  title="清除搜索"
                  onClick={() => {
                    setQuery("");
                    setSearch("");
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="rounded-xl border border-[var(--border)] bg-white/90 px-3 py-2 text-sm shadow-sm hover:bg-[var(--panel-2)]"
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
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
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {uploading && (
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-blue-100">
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
        className={`glass-panel flex-1 rounded-2xl border border-[var(--border)] ${
          dragOver ? "ring-2 ring-[var(--accent)] ring-offset-2" : ""
        }`}
      >
        {loading ? (
          <div className="flex h-64 items-center justify-center text-[var(--muted)]">加载中…</div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div
            className="flex h-64 cursor-pointer flex-col items-center justify-center gap-2 text-[var(--muted)]"
            onClick={() => fileInputRef.current?.click()}
            onContextMenu={(e) => openContext(e, { type: "blank" })}
          >
            <div className="rounded-2xl bg-gradient-to-br from-blue-100 to-teal-100 p-4 text-[var(--accent)]">
              <IconUpload className="h-10 w-10" />
            </div>
            <p>拖拽文件到此处，或点击上传</p>
            <p className="text-xs">右键可新建文件夹 / 上传</p>
            <p className="text-xs">当前路径：{folder}</p>
          </div>
        ) : viewMode === "gallery" ? (
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {folders.map((name) => (
                <button
                  key={`folder-${name}`}
                  type="button"
                  onClick={() => setFolder(joinFolder(folder, name))}
                  onContextMenu={(e) => openContext(e, { type: "folder", name })}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                >
                  <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100">
                    <IconFolder className="h-14 w-14 text-amber-500 transition group-hover:scale-105" />
                  </div>
                  <div className="truncate px-3 py-2 text-sm font-medium text-slate-700">{name}</div>
                  <div className="px-3 pb-2 text-xs text-slate-400">文件夹</div>
                </button>
              ))}
              {files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setPreview(file)}
                  onContextMenu={(e) => openContext(e, { type: "file", file })}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                  title={file.name}
                >
                  <ThumbImage
                    id={file.id}
                    kind={file.kind}
                    name={file.name}
                    className="aspect-square w-full"
                  />
                  <div className="truncate px-3 py-2 text-sm font-medium text-slate-700">{file.name}</div>
                  <div className="flex items-center justify-between px-3 pb-2 text-xs text-slate-400">
                    <span>{formatBytes(file.size)}</span>
                    <span>{file.kind}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
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
        )}
      </div>

      <footer className="mt-6 pb-20 text-center text-xs text-[var(--muted)]">
        右下角菜单 · 右键可管理文件 · 画廊仅加载缩略图
      </footer>

      {/* 右下角悬浮菜单（向上展开） */}
      <div ref={fabRef} className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
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
                className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium shadow-lg transition hover:scale-[1.02] disabled:opacity-50 ${
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
                {item.label}
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

      {uploading && (
        <div className="fixed bottom-24 right-5 z-40 min-w-[140px] rounded-full border border-sky-100 bg-white px-3 py-1.5 text-center text-xs font-medium text-sky-700 shadow-lg">
          上传中 {uploadPct}%
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
    </div>
  );
}
