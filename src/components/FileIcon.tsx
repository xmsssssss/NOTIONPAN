import type { FileKind } from "@/lib/types";
import { getExt } from "@/lib/utils";
import { IconAudio, IconFile, IconImage, IconPdf, IconVideo } from "./icons";

/** 扩展名 → 展示色 + 角标 */
const EXT_META: Record<string, { bg: string; fg: string; label: string }> = {
  // docs
  md: { bg: "#0f172a", fg: "#38bdf8", label: "MD" },
  markdown: { bg: "#0f172a", fg: "#38bdf8", label: "MD" },
  txt: { bg: "#475569", fg: "#f8fafc", label: "TXT" },
  pdf: { bg: "#b91c1c", fg: "#fff", label: "PDF" },
  doc: { bg: "#1d4ed8", fg: "#fff", label: "DOC" },
  docx: { bg: "#1d4ed8", fg: "#fff", label: "DOC" },
  xls: { bg: "#15803d", fg: "#fff", label: "XLS" },
  xlsx: { bg: "#15803d", fg: "#fff", label: "XLS" },
  ppt: { bg: "#c2410c", fg: "#fff", label: "PPT" },
  pptx: { bg: "#c2410c", fg: "#fff", label: "PPT" },
  rtf: { bg: "#4338ca", fg: "#fff", label: "RTF" },
  // code
  js: { bg: "#ca8a04", fg: "#fff", label: "JS" },
  mjs: { bg: "#ca8a04", fg: "#fff", label: "JS" },
  cjs: { bg: "#ca8a04", fg: "#fff", label: "JS" },
  ts: { bg: "#2563eb", fg: "#fff", label: "TS" },
  tsx: { bg: "#2563eb", fg: "#fff", label: "TSX" },
  jsx: { bg: "#0891b2", fg: "#fff", label: "JSX" },
  json: { bg: "#a16207", fg: "#fff", label: "{}" },
  html: { bg: "#ea580c", fg: "#fff", label: "HTML" },
  htm: { bg: "#ea580c", fg: "#fff", label: "HTML" },
  css: { bg: "#0284c7", fg: "#fff", label: "CSS" },
  scss: { bg: "#db2777", fg: "#fff", label: "SCSS" },
  less: { bg: "#1d4ed8", fg: "#fff", label: "LESS" },
  py: { bg: "#ca8a04", fg: "#fff", label: "PY" },
  go: { bg: "#0e7490", fg: "#fff", label: "GO" },
  rs: { bg: "#ea580c", fg: "#fff", label: "RS" },
  java: { bg: "#b45309", fg: "#fff", label: "JAVA" },
  c: { bg: "#475569", fg: "#fff", label: "C" },
  cpp: { bg: "#0369a1", fg: "#fff", label: "C++" },
  h: { bg: "#475569", fg: "#fff", label: "H" },
  hpp: { bg: "#0369a1", fg: "#fff", label: "HPP" },
  cs: { bg: "#7c3aed", fg: "#fff", label: "C#" },
  php: { bg: "#7c3aed", fg: "#fff", label: "PHP" },
  rb: { bg: "#be123c", fg: "#fff", label: "RB" },
  sh: { bg: "#334155", fg: "#a3e635", label: "SH" },
  bash: { bg: "#334155", fg: "#a3e635", label: "SH" },
  ps1: { bg: "#0284c7", fg: "#fff", label: "PS1" },
  sql: { bg: "#0f766e", fg: "#fff", label: "SQL" },
  yaml: { bg: "#be185d", fg: "#fff", label: "YML" },
  yml: { bg: "#be185d", fg: "#fff", label: "YML" },
  toml: { bg: "#9a3412", fg: "#fff", label: "TOML" },
  xml: { bg: "#c2410c", fg: "#fff", label: "XML" },
  vue: { bg: "#16a34a", fg: "#fff", label: "VUE" },
  svelte: { bg: "#e11d48", fg: "#fff", label: "SVEL" },
  // archive
  zip: { bg: "#a16207", fg: "#fff", label: "ZIP" },
  rar: { bg: "#a16207", fg: "#fff", label: "RAR" },
  "7z": { bg: "#a16207", fg: "#fff", label: "7Z" },
  tar: { bg: "#a16207", fg: "#fff", label: "TAR" },
  gz: { bg: "#a16207", fg: "#fff", label: "GZ" },
  tgz: { bg: "#a16207", fg: "#fff", label: "TGZ" },
  bz2: { bg: "#a16207", fg: "#fff", label: "BZ2" },
  xz: { bg: "#a16207", fg: "#fff", label: "XZ" },
  // media extras
  svg: { bg: "#db2777", fg: "#fff", label: "SVG" },
  ico: { bg: "#7c3aed", fg: "#fff", label: "ICO" },
  gif: { bg: "#c026d3", fg: "#fff", label: "GIF" },
  webp: { bg: "#0d9488", fg: "#fff", label: "WEBP" },
  // subtitle / lyric
  srt: { bg: "#4f46e5", fg: "#fff", label: "SRT" },
  vtt: { bg: "#4f46e5", fg: "#fff", label: "VTT" },
  ass: { bg: "#4f46e5", fg: "#fff", label: "ASS" },
  ssa: { bg: "#4f46e5", fg: "#fff", label: "SSA" },
  lrc: { bg: "#db2777", fg: "#fff", label: "LRC" },
  // data
  csv: { bg: "#15803d", fg: "#fff", label: "CSV" },
  tsv: { bg: "#15803d", fg: "#fff", label: "TSV" },
  // package / binary
  exe: { bg: "#64748b", fg: "#fff", label: "EXE" },
  msi: { bg: "#64748b", fg: "#fff", label: "MSI" },
  dmg: { bg: "#64748b", fg: "#fff", label: "DMG" },
  apk: { bg: "#16a34a", fg: "#fff", label: "APK" },
  ipa: { bg: "#64748b", fg: "#fff", label: "IPA" },
  iso: { bg: "#475569", fg: "#fff", label: "ISO" },
  bin: { bg: "#475569", fg: "#fff", label: "BIN" },
  dll: { bg: "#475569", fg: "#fff", label: "DLL" },
  // font
  ttf: { bg: "#7c3aed", fg: "#fff", label: "TTF" },
  otf: { bg: "#7c3aed", fg: "#fff", label: "OTF" },
  woff: { bg: "#7c3aed", fg: "#fff", label: "WOFF" },
  woff2: { bg: "#7c3aed", fg: "#fff", label: "WOFF" },
  // ebook
  epub: { bg: "#0f766e", fg: "#fff", label: "EPUB" },
  mobi: { bg: "#0f766e", fg: "#fff", label: "MOBI" },
};

function badgeLabel(ext: string, metaLabel: string): string {
  if (metaLabel.length <= 4) return metaLabel;
  return ext.slice(0, 4).toUpperCase();
}

function ExtBadge({
  ext,
  className,
}: {
  ext: string;
  className?: string;
}) {
  const meta = EXT_META[ext] || {
    bg: "#64748b",
    fg: "#fff",
    label: (ext || "FILE").slice(0, 4).toUpperCase() || "FILE",
  };
  const label = badgeLabel(ext, meta.label);
  // className 通常是 h-5 w-5 / h-6 w-6，角标填满该尺寸
  const fontClass =
    label.length <= 2
      ? "text-[0.55rem] sm:text-[0.6rem]"
      : label.length === 3
        ? "text-[0.45rem] sm:text-[0.5rem]"
        : "text-[0.38rem] sm:text-[0.42rem]";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[22%] font-bold leading-none tracking-tight shadow-sm ${fontClass} ${className || "h-5 w-5"}`}
      style={{ background: meta.bg, color: meta.fg }}
      title={ext ? `.${ext}` : "file"}
      aria-hidden
    >
      {label}
    </span>
  );
}

/**
 * 文件图标：
 * - image/video/audio/pdf 用专用 SVG
 * - 其它按扩展名彩色角标（MD / ZIP / JS…）
 */
export function FileIcon({
  kind,
  name,
  className,
}: {
  kind: FileKind;
  /** 文件名，用于扩展名角标 */
  name?: string;
  className?: string;
}) {
  const ext = name ? getExt(name) : "";

  if (kind === "image") return <IconImage className={className} />;
  if (kind === "video") return <IconVideo className={className} />;
  if (kind === "audio") return <IconAudio className={className} />;
  if (kind === "pdf" || ext === "pdf") return <IconPdf className={className} />;

  if (ext) {
    return <ExtBadge ext={ext} className={className} />;
  }
  return <IconFile className={className} />;
}
