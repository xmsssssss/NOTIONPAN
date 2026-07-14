import type { FileKind } from "@/lib/types";
import { IconAudio, IconFile, IconImage, IconPdf, IconVideo } from "./icons";

export function FileIcon({ kind, className }: { kind: FileKind; className?: string }) {
  switch (kind) {
    case "image":
      return <IconImage className={className} />;
    case "video":
      return <IconVideo className={className} />;
    case "audio":
      return <IconAudio className={className} />;
    case "pdf":
      return <IconPdf className={className} />;
    default:
      return <IconFile className={className} />;
  }
}
