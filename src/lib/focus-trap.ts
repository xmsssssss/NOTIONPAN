/**
 * 焦点陷阱的纯逻辑：给定可聚焦元素列表、当前焦点与 Shift 状态，
 * 计算 Tab 应该落到哪个下标；返回 null 表示交给浏览器默认行为。
 */
export function nextTrapIndex(
  count: number,
  activeIndex: number,
  shift: boolean,
): number | null {
  if (count <= 0) return null;
  // 焦点不在面板内（-1）：拉回首/尾
  if (activeIndex < 0) return shift ? count - 1 : 0;
  if (shift && activeIndex === 0) return count - 1;
  if (!shift && activeIndex === count - 1) return 0;
  return null;
}

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** 面板内当前可见、可聚焦的元素 */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0,
  );
}
