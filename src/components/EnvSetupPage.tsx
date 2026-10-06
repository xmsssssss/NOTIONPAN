"use client";

import { useState } from "react";

export function EnvSetupPage({
  siteTitle,
  onSuccess,
  onOpenAdmin,
}: {
  siteTitle: string;
  onSuccess: () => void;
  onOpenAdmin?: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [databaseId, setDatabaseId] = useState("");
  const [dataSourceId, setDataSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // 令牌类型只影响引导文案：PAT 不需要给数据库添加连接
  const [tokenMode, setTokenMode] = useState<"pat" | "integration">("pat");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!apiKey.trim()) throw new Error("请填写 NOTION_API_KEY");
      const dbRaw = databaseId.trim().replace(/\s/g, "");
      if (dbRaw && dbRaw.replace(/-/g, "").length < 32) {
        throw new Error("Database ID 格式不正确（约 32 位字符），或留空稍后自动建库");
      }

      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          env: {
            NOTION_API_KEY: apiKey.trim(),
            ...(dbRaw
              ? {
                  NOTION_DATABASE_ID: dbRaw,
                  NOTION_DATA_SOURCE_ID: dataSourceId.trim(),
                }
              : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");

      // 有 Database ID 时尝试自动补全缺失属性
      if (dbRaw) {
        try {
          await fetch("/api/admin/schema", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "repair" }),
          });
        } catch {
          // ignore
        }
      }
      // 配置已写入；进入网盘时再同步索引
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-[100dvh] max-h-[100dvh] max-w-3xl flex-col overflow-y-auto overscroll-contain px-4 py-8 sm:px-6">
      <div className="mb-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-sky-600">
          首次配置
        </div>
        <h1 className="text-2xl font-bold text-slate-800">{siteTitle || "NotionPan"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          未检测到 Notion 环境变量。请按步骤获取并填写，保存后即可使用网盘。
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {[
          { n: 1 as const, t: "获取 API Key" },
          { n: 2 as const, t: tokenMode === "pat" ? "创建数据库" : "建库并授权" },
          { n: 3 as const, t: "获取 Database ID" },
          { n: 4 as const, t: "填写配置" },
        ].map((s) => (
          <button
            key={s.n}
            type="button"
            onClick={() => setStep(s.n)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              step === s.n
                ? "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {s.n}. {s.t}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {step === 1 && (
          <Card title="① 获取 NOTION_API_KEY（访问令牌）">
            <div
              role="radiogroup"
              aria-label="令牌类型"
              className="mb-4 grid gap-2 sm:grid-cols-2"
            >
              {[
                {
                  v: "pat" as const,
                  t: "个人访问令牌（PAT）· 推荐",
                  d: "以你本人身份访问，无需给数据库添加连接；不受多成员免费工作区 1000 块上限约束。",
                },
                {
                  v: "integration" as const,
                  t: "内部连接（集成令牌）",
                  d: "工作区所有，不依赖某个成员；需要把数据库手动授权给该连接。",
                },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={tokenMode === o.v}
                  onClick={() => setTokenMode(o.v)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${
                    tokenMode === o.v
                      ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="text-sm font-medium text-slate-800">{o.t}</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-500">{o.d}</div>
                </button>
              ))}
            </div>

            {tokenMode === "pat" ? (
              <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-slate-600">
                <li>
                  打开个人访问令牌页面：
                  <a
                    className="ml-1 break-all font-medium text-sky-600 underline"
                    href="https://www.notion.so/developers/tokens"
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://www.notion.so/developers/tokens
                  </a>
                </li>
                <li>
                  点击 <strong>「New token」</strong>，输入<strong>令牌名称</strong>
                </li>
                <li>
                  能力勾选 <strong>Notion API</strong>；如出现工作空间选择，选数据库所在的
                  <strong>工作空间</strong>
                </li>
                <li>
                  选择<strong>有效期</strong>（最长 1 年，不选默认 1 年），点击
                  <strong>「Create token」</strong>
                </li>
                <li>
                  立即复制令牌（只显示这一次）
                  <br />
                  <span className="text-xs text-slate-400">一般以 ntn_ 开头</span>
                </li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-slate-600">
                <li>
                  打开 Notion 开发者后台：
                  <a
                    className="ml-1 break-all font-medium text-sky-600 underline"
                    href="https://app.notion.com/developers"
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://app.notion.com/developers
                  </a>
                </li>
                <li>
                  点击左侧 <strong>「连接」</strong>（Connections）
                </li>
                <li>
                  点击右侧 <strong>「+ 新连接」</strong>（New connection）
                </li>
                <li>
                  输入<strong>连接名称</strong>，选择<strong>访问令牌</strong>，选择要使用的
                  <strong>工作空间</strong>
                </li>
                <li>
                  点击<strong>创建连接</strong>
                </li>
                <li>
                  选中你的连接，复制 <strong>访问令牌</strong>
                  <br />
                  <span className="text-xs text-slate-400">一般以 ntn_ 开头</span>
                </li>
              </ol>
            )}

            {tokenMode === "pat" ? (
              <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                PAT 用的是创建者本人的权限：你失去数据库访问权或离开工作区、令牌到期或被撤销后，网盘会无法访问（返回 401），需要重新创建并在后台替换。免费工作区只有所有者能创建 PAT。
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                多成员免费工作区：自 2026-09-01 起内部连接受「累计 1000 块」上限约束（每个文件约占 1–2 块），用满后无法再上传。
              </div>
            )}
            <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              本步复制的令牌，将在第 4 步填入 <code className="rounded bg-white px-1">NOTION_API_KEY</code>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white"
              >
                下一步
              </button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card title={tokenMode === "pat" ? "② 创建数据库" : "② 创建数据库并为连接授权"}>
            <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-slate-600">
              <li>
                新建<strong>私人页面</strong>，在下方「开始使用」中选择
                <strong>数据库</strong>，配置数据库名称
              </li>
              <li>
                配置列（属性名必须一致）：
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">属性名</th>
                        <th className="px-3 py-2">类型</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700">
                      {[
                        ["Name", "Title"],
                        ["Folder", "Text"],
                        ["Size", "Number"],
                        ["MIME", "Text"],
                        ["Type", "Select：image / video / audio / pdf / file"],
                        ["File", "Files & media"],
                      ].map(([a, b]) => (
                        <tr key={a} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 font-mono">{a}</td>
                          <td className="px-3 py-1.5">{b}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  建议：在 Notion 页面直接打开 AI，把上表发给它，让它帮你生成数据库结构。
                </p>
              </li>
              {tokenMode === "integration" && (
                <>
                  <li>
                    打开数据库页面 → 右上角 <strong>三个点 ···</strong> → 移到
                    <strong>「集成 / Integrations」</strong>
                  </li>
                  <li>
                    输入你在第 1 步创建的<strong>连接名称</strong>，点击
                    <strong>「添加到页面」</strong>
                  </li>
                </>
              )}
            </ol>
            {tokenMode === "pat" && (
              <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                使用 PAT 无需「添加连接」：只要你本人能打开这个数据库即可。
              </div>
            )}
            <div className="mt-4 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600"
              >
                上一步
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white"
              >
                下一步
              </button>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card title="③ 获取 Database ID">
            <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-slate-600">
              <li>打开第 2 步创建的数据库页面</li>
              <li>
                看浏览器地址栏，例如：
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-sky-100">
{`https://app.notion.com/p/xxxxxxxxxxxxxxxxxxxx?v=39d72c34808b844f00
                         ↑
              这一段 32 位字符 = NOTION_DATABASE_ID
              （不要用 ?v= 后面的视图 ID）`}
                </pre>
              </li>
              <li>
                复制 <code className="rounded bg-slate-100 px-1">/p/</code> 后面那串约 32
                位字符（可带或不带连字符）
              </li>
            </ol>
            <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              本步复制的 ID，将在第 4 步填入{" "}
              <code className="rounded bg-white px-1">NOTION_DATABASE_ID</code>
            </div>
            <div className="mt-4 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600"
              >
                上一步
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white"
              >
                下一步
              </button>
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card title="④ 填写配置">
            <form onSubmit={(e) => void save(e)} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">
                  NOTION_API_KEY <span className="text-red-500">*</span>
                  <span className="ml-2 text-xs font-normal text-slate-400">（第 1 步复制的访问令牌）</span>
                </span>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  placeholder="ntn_xxxxxxxx"
                  required
                  autoComplete="off"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">
                  NOTION_DATABASE_ID
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    （有则填；无则保存后后台「自动建库」）
                  </span>
                </span>
                <input
                  value={databaseId}
                  onChange={(e) => setDatabaseId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  placeholder="32 位 ID，可留空"
                  autoComplete="off"
                />
              </label>

              <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/60 px-3 py-2.5 text-xs text-slate-600">
                <p className="font-medium text-sky-800">还没有数据库？</p>
                <p className="mt-1">
                  可先只填 API Key，保存后到后台「索引同步」点「自动建库」；已有库但缺列可点「修复 Schema」。
                </p>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">
                  NOTION_DATA_SOURCE_ID
                  <span className="ml-2 text-xs font-normal text-slate-400">（可选，一般可留空）</span>
                </span>
                <input
                  value={dataSourceId}
                  onChange={(e) => setDataSourceId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  placeholder="可留空，程序会自动探测"
                  autoComplete="off"
                />
              </label>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600"
                >
                  上一步
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-gradient-to-r from-sky-500 to-teal-400 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 disabled:opacity-60"
                >
                  {busy ? "保存中…" : "保存并进入网盘"}
                </button>
              </div>
            </form>

            <p className="mt-4 text-xs text-slate-400">
              配置会写入 <code className="rounded bg-slate-100 px-1">.env.local</code> 并立即软加载。
              之后可在后台「环境变量」修改。
              {onOpenAdmin && (
                <>
                  {" "}
                  <button type="button" className="text-sky-600 underline" onClick={onOpenAdmin}>
                    打开后台
                  </button>
                </>
              )}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}
