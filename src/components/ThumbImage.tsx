"use client";

import { useState } from "react";
import { FileIcon } from "./FileIcon";
import type { FileKind } from "@/lib/types";

export function ThumbImage({
  id,
  kind,
  name,
  className = "",
}: {
  id: string;
  kind: FileKind;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isImage = kind === "image";

  if (!isImage || failed) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 ${className}`}>
        <FileIcon kind={kind} className="h-10 w-10 opacity-70" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-100 to-slate-200" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/files/${id}/thumb`}
        alt={name}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
