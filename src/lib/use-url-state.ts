import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  navigateUrlState,
  parseUrlState,
  subscribeUrlState,
  type UrlState,
} from "./url-state";

const subscribe = (cb: () => void) => subscribeUrlState(() => cb());
const getSnapshot = () => window.location.search;
// SSR / 首次水合：按默认状态渲染，水合后自动切到真实地址栏
const getServerSnapshot = () => "";

/**
 * 地址栏驱动的文件夹 / 视图状态。
 * 用 useSyncExternalStore 订阅 history，不在 effect 里 setState。
 */
export function useUrlState(): [
  UrlState,
  (patch: Partial<UrlState>, opts?: { replace?: boolean }) => void,
] {
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const state = useMemo(() => parseUrlState(search), [search]);
  const navigate = useCallback(
    (patch: Partial<UrlState>, opts?: { replace?: boolean }) => navigateUrlState(patch, opts),
    [],
  );
  return [state, navigate];
}
