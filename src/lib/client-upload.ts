/** 浏览器 → 本服务 POST /api/files → 服务端调用 Notion 官方 API（密钥不离开服务器） */

export function uploadViaServer(
  file: File,
  folder: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
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
