export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[100dvh] items-center justify-center"
    >
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-sky-200 border-t-sky-500" />
      <span className="sr-only">加载中…</span>
    </div>
  );
}
