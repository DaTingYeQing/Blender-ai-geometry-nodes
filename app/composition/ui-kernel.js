/* ===== 组装根：全局 UI 内核 =====
 * state.md 要求“一个全局 UiState”，region.md 要求“FocusManager 全局唯一”。
 * 这里把两者及其根区域放在一起创建，全应用只调用一次；具体区域只是挂上来的子树。
 *
 *   focus（唯一聚焦权威）
 *     └─ root RegionHost（id 与 focusPath[0] 一致）
 *          └─ 各区域 createRegionHost({ parent: root })
 *
 * store 与 effects 的循环用工厂解开：
 *   dispatch 需要 store，effects 需要 dispatch，store 又需要 effects.execute。
 * 先建 dispatch 闭包，调用方在工厂里拿到稳定引用后再建 effects。
 */

import { createUiStore } from '../ui/state/store.js';
import { createInitialUiState } from '../ui/state/initial.js';
import { reduce } from '../ui/state/root.js';
import { EVENTS } from '../ui/contracts/events.js';
import { createFocusManager } from '../ui/regions/focus-manager.js';
import { createRegionHost } from '../ui/regions/region-host.js';

/**
 * @param {{
 *   rootId?: string,
 *   initialState?: import('../ui/contracts/state.js').UiState,
 *   reduce?: (state: any, event: any) => import('../ui/contracts/state.js').UiTransition,
 *   createEffects?: (ctx: { dispatch: (event: any) => Promise<any> }) => {
 *     execute?: (command: any) => Promise<unknown> | unknown,
 *     [key: string]: unknown,
 *   },
 *   onError?: (error: unknown) => void,
 * }} [options]
 * @returns {{
 *   store: ReturnType<typeof createUiStore>,
 *   focus: ReturnType<typeof createFocusManager>,
 *   root: ReturnType<typeof createRegionHost>,
 *   dispatch: (event: any) => Promise<any>,
 *   effects: object,
 *   destroy: () => void,
 * }}
 */
export function createUiKernel({
  rootId = 'app',
  initialState,
  reduce: rootReduce = reduce,
  createEffects,
  onError,
} = {}) {
  if (typeof createEffects !== 'function') {
    throw new Error('createUiKernel: 需要 createEffects({ dispatch })');
  }

  const focus = createFocusManager({ rootId });

  /** store 建好前也要能收事件：先转发，真正 dispatch 在下面补上。 */
  let store;
  const dispatch = (event) => store.dispatch(event);

  const effects = createEffects({ dispatch }) || {};

  store = createUiStore({
    initialState: initialState ?? createInitialUiState(),
    reduce: rootReduce,
    execute: effects.execute,
    onError,
  });

  const root = createRegionHost({ id: rootId, focus, dispatch });

  /* 聚焦变化是 UI 状态：FocusManager 广播，State 记录。 */
  const unsubscribeFocus = focus.subscribe((path) => {
    void dispatch({ type: EVENTS.FOCUS_CHANGED, kind: 'focus', payload: { path } });
  });

  return {
    store,
    focus,
    root,
    dispatch,
    effects,
    destroy: () => {
      unsubscribeFocus();
      root.destroy();
    },
  };
}
