"use client";

import { useEffect } from "react";

/** 路由级错误边界：渲染异常时给出重试，而不是整页白屏 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      role="alert"
      className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-lg font-semibold text-slate-800">页面出错了</h1>
      <p className="text-sm text-slate-500">
        {error.message || "发生了未知错误"}
        {error.digest ? `（${error.digest}）` : ""}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-gradient-to-r from-sky-500 to-teal-400 px-4 py-2 text-sm font-medium text-white shadow"
        >
          重试
        </button>
        <button
          type="button"
          onClick={() => window.location.assign("/")}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600"
        >
          回到首页
        </button>
      </div>
    </main>
  );
}
