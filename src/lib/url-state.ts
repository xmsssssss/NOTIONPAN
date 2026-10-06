/**
 * 前端 URL 状态：把当前文件夹与视图（网盘 / 后台）写进查询串，
 * 支持浏览器后退、刷新保持位置、深链分享。
 *
 *   /?path=/照片/2024        → 网盘，位于 /照片/2024
 *   /?view=admin             → 后台
 *   /?view=admin&path=/照片  → 后台；返回网盘时回到 /照片
 *
 * 纯函数部分（parse/build）可单测；history 操作集中在 navigate/subscribe。
 */
import { sanitizeFolder } from "./utils";

export type AppView = "app" | "admin";

export type UrlState = {
  folder: string;
  view: AppView;
};

/** 解析查询串（可带或不带前导 ?）；非法值回退为默认 */
export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const folder = sanitizeFolder(params.get("path"));
  const view: AppView = params.get("view") === "admin" ? "admin" : "app";
  return { folder, view };
}

/**
 * 基于现有查询串生成新查询串：只改 path / view，保留其它未知参数。
 * 默认值（根目录、网盘视图）不写入，保持 URL 干净。返回 "" 或 "?..."。
 */
export function buildUrlSearch(currentSearch: string, patch: Partial<UrlState>): string {
  const params = new URLSearchParams(
    currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch,
  );
  if (patch.folder !== undefined) {
    const f = sanitizeFolder(patch.folder);
    if (f === "/") params.delete("path");
    else params.set("path", f);
  }
  if (patch.view !== undefined) {
    if (patch.view === "admin") params.set("view", "admin");
    else params.delete("view");
  }
  const s = params.toString();
  // URLSearchParams 会把 "/" 编码成 %2F，路径里保留斜杠更易读
  return s ? `?${s.replace(/%2F/gi, "/")}` : "";
}

/** 读取当前地址栏状态（SSR 时返回默认值） */
export function readUrlState(): UrlState {
  if (typeof window === "undefined") return { folder: "/", view: "app" };
  return parseUrlState(window.location.search);
}

const URL_STATE_EVENT = "notionpan:urlstate";

/**
 * 修改地址栏。默认 push（可后退）；replace=true 用于不应产生历史记录的同步。
 * 状态未变化时不写历史，避免重复条目。
 */
export function navigateUrlState(patch: Partial<UrlState>, opts?: { replace?: boolean }): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  const next = buildUrlSearch(search, patch);
  if (next === search || (next === "" && search === "?")) return;
  const url = `${pathname}${next}${hash}`;
  if (opts?.replace) window.history.replaceState(window.history.state, "", url);
  else window.history.pushState(window.history.state, "", url);
  // pushState 不触发 popstate；派发自定义事件让各订阅方同步
  window.dispatchEvent(new Event(URL_STATE_EVENT));
}

/** 订阅地址栏变化（后退/前进 + 本模块的 navigate）；返回取消订阅函数 */
export function subscribeUrlState(cb: (state: UrlState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(readUrlState());
  window.addEventListener("popstate", handler);
  window.addEventListener(URL_STATE_EVENT, handler);
  return () => {
    window.removeEventListener("popstate", handler);
    window.removeEventListener(URL_STATE_EVENT, handler);
  };
}
