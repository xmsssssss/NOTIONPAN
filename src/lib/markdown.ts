/**
 * Markdown → 安全 HTML
 * - marked：GFM（表格、任务列表、删除线、自动链接、嵌套列表等）
 * - isomorphic-dompurify：消毒（保留 details/summary 等）
 */

import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

marked.setOptions({
  gfm: true,
  breaks: false,
  pedantic: false,
});

const PURIFY: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true },
  ADD_TAGS: [
    "details",
    "summary",
    "mark",
    "kbd",
    "samp",
    "sub",
    "sup",
    "figure",
    "figcaption",
    "input",
  ],
  ADD_ATTR: [
    "open",
    "class",
    "id",
    "target",
    "rel",
    "loading",
    "align",
    "colspan",
    "rowspan",
    "start",
    "checked",
    "disabled",
    "type",
    "name",
    "value",
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "button", "textarea", "select"],
  FORBID_ATTR: ["style", "srcdoc"],
};

function postProcessHtml(html: string): string {
  let s = html;

  // 外链 target/rel
  s = s.replace(
    /<a\s+([^>]*href="https?:\/\/[^"]*"[^>]*)>/gi,
    (_full, attrs: string) => {
      let a = attrs;
      if (!/\btarget=/i.test(a)) a += ' target="_blank"';
      if (!/\brel=/i.test(a)) a += ' rel="noopener noreferrer"';
      return `<a ${a}>`;
    },
  );

  // 仅保留 checkbox 类型的 input，并强制 disabled
  s = s.replace(/<input\b([^>]*)\/?>/gi, (full, attrs: string) => {
    if (!/type\s*=\s*["']?checkbox["']?/i.test(attrs)) return "";
    let a = attrs;
    if (!/\bdisabled\b/i.test(a)) a += " disabled";
    return `<input${a}>`;
  });

  // GFM task list class（marked 输出 class="task-list-item"）
  s = s.replace(
    /<ul(\s[^>]*)?>\s*(?=<li[^>]*class="[^"]*task-list-item)/i,
    '<ul class="np-md-tasklist contains-task-list">',
  );
  s = s.replace(
    /class="([^"]*\btask-list-item\b[^"]*)"/gi,
    'class="$1 np-md-task"',
  );

  // 表格横向滚动包装（避免重复包）
  if (!s.includes("np-md-table-wrap")) {
    s = s.replace(
      /<table(\s[^>]*)?>/gi,
      '<div class="np-md-table-wrap"><table class="np-md-table"$1>',
    );
    s = s.replace(/<\/table>/gi, "</table></div>");
  } else {
    s = s.replace(/<table(\s[^>]*)?>/gi, '<table class="np-md-table"$1>');
  }

  // 代码块
  s = s.replace(/<pre(\s[^>]*)?>/gi, '<pre class="np-md-code"$1>');

  return s;
}

export function renderMarkdown(src: string): string {
  const raw = typeof src === "string" ? src : "";
  let html: string;
  try {
    html = marked.parse(raw, { async: false }) as string;
  } catch {
    const esc = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    html = `<pre class="np-md-code"><code>${esc}</code></pre>`;
  }

  const clean = DOMPurify.sanitize(html, PURIFY);
  return postProcessHtml(String(clean));
}

export function isMarkdownFile(name: string, mimeType?: string): boolean {
  if (/\.(md|markdown|mdown|mkd)$/i.test(name)) return true;
  if (mimeType === "text/markdown" || mimeType === "text/x-markdown") return true;
  return false;
}
