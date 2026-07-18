/** 渐变圆角站点图标 */
export function SiteIcon({
  letter = "N",
  className = "h-10 w-10 text-base sm:h-11 sm:w-11 sm:text-lg",
}: {
  letter?: string;
  className?: string;
}) {
  const ch = (letter || "N").trim().slice(0, 2) || "N";
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] via-[#6d8fff] to-[var(--accent-2)] font-bold text-white shadow-lg shadow-blue-400/30 ${className}`}
      aria-hidden
    >
      {ch}
    </div>
  );
}
