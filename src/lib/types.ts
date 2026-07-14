export type FileKind = "image" | "video" | "audio" | "pdf" | "file";

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: FileKind;
  folder: string;
  createdTime: string;
  lastEditedTime: string;
  url?: string;
  expiryTime?: string;
  downloadUrl?: string;
}

export interface ListFilesResult {
  files: DriveFile[];
  folders: string[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface UploadResult {
  file: DriveFile;
}
