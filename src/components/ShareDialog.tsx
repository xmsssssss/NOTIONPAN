"use client";

import { useEffect, useState } from "react";
import type { DriveFile } from "@/lib/types";
import { errorMessage, toast } from "@/lib/toast";
import { BtnGhost, BtnPrimary, Dialog, DialogInput } from "./Dialog";

type ShareInfo = {
  token: string;
  expiresAt: string | null;
  hasPassword: boolean;
  accessCount: number;
};

async function copyWithToast(text: string) {
  const { copyTextToClipboard } = await import("@/lib/client-file");
  const ok = await copyTextToClipboard(text);
  if (ok) toast.success("已复制到剪贴板");
  else toast.error("复制失败，请手动选择链接复制");
}

/**
 * 分享弹窗：自管表单与分享列表状态。
 * 调用方用 key={file.id} 挂载，换文件时状态自动重置。
 */
export function ShareDialog({ file, onClose }: { file: DriveFile | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [expire, setExpire] = useState("0");
  const [url, setUrl] = useState<string | null>(null);
  const [list, setList] = useState<ShareInfo[]>([]);

  const fileId = file?.id;
  useEffect(() => {
    if (!fileId) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/share?fileId=${encodeURIComponent(fileId)}`);
        const data = await res.json();
        if (alive && res.ok) setList(data.shares || []);
      } catch {
        // 列表加载失败不影响生成新链接
      }
    })();
    return () => {
      alive = false;
    };
  }, [fileId]);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          password: password || undefined,
          expiresInHours: expire === "0" ? null : Number(expire),
          allowDownload: true,
          allowPreview: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建分享失败");
      setUrl(data.url);
      setList((prev) => [data.share, ...prev]);
      toast.success("分享链接已生成");
    } catch (e) {
      toast.error(errorMessage(e, "创建分享失败"));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    if (!confirm("确定撤销该分享链接？")) return;
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "撤销失败");
      setList((prev) => prev.filter((s) => s.token !== token));
      if (url?.includes(token)) setUrl(null);
      toast.success("分享已撤销");
    } catch (e) {
      toast.error(errorMessage(e, "撤销失败"));
    }
  };

  return (
    <Dialog
      open={Boolean(file)}
      title="分享文件"
      description={file ? `「${file.name}」` : undefined}
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <BtnGhost onClick={onClose}>关闭</BtnGhost>
          <BtnPrimary onClick={() => void submit()} disabled={busy}>
            {busy ? "生成中…" : "生成链接"}
          </BtnPrimary>
        </>
      }
    >
      <div className="space-y-4">
        <DialogInput
          label="访问密码（可选）"
          value={password}
          onChange={setPassword}
          placeholder="留空则任何人可打开"
        />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">有效期</span>
          <select
            value={expire}
            onChange={(e) => setExpire(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          >
            <option value="0">永久有效</option>
            <option value="1">1 小时</option>
            <option value="24">1 天</option>
            <option value="168">7 天</option>
            <option value="720">30 天</option>
          </select>
        </label>

        {url && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="mb-1 text-xs font-medium text-emerald-800">分享链接已生成</div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs text-emerald-900">{url}</code>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
                onClick={() => void copyWithToast(url)}
              >
                复制
              </button>
            </div>
          </div>
        )}

        {list.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">已有分享</div>
            <div className="max-h-40 space-y-2 overflow-auto">
              {list.map((s) => (
                <div
                  key={s.token}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-slate-600">/s/{s.token.slice(0, 10)}…</div>
                    <div className="text-slate-400">
                      {s.hasPassword ? "有密码 · " : ""}
                      {s.expiresAt ? `过期 ${new Date(s.expiresAt).toLocaleString("zh-CN")}` : "永久"}
                      {` · 访问 ${s.accessCount ?? 0} 次`}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded-md bg-white px-2 py-1 text-sky-600 ring-1 ring-slate-200"
                      onClick={() => {
                        const link = `${window.location.origin}/s/${s.token}`;
                        void copyWithToast(link);
                        setUrl(link);
                      }}
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-white px-2 py-1 text-red-600 ring-1 ring-slate-200"
                      onClick={() => void revoke(s.token)}
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
  );
}
