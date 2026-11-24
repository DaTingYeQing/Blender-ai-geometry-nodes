/* ===== RegionHost（区域管家）=====
 * region.md 5.1.2：每个区域一个，只做三件事——登记、转发、报告。
 * 不做业务判断，不调 API，不改状态，也不决定聚焦。
 *
 *   - 登记：子组件 / 子区域通过 registerChild 挂进来，destroy 时递归卸掉。
 *   - 转发：emit 把组件事件补上 regionId 与路径，交给统一的 dispatch。
 *     能不能改状态由 State 入口按 kind 判断（见 ui/state/guard.js），这里不拦。
 *   - 报告：聚焦变化转成 onActivate / onDeactivate，并把浏览器焦点交给
 *     区域自己安排（focusTarget），不让每个组件去抢。
 *
 * 生命周期：mount → activate / deactivate → destroy（幂等）。
 */

import { createDisposeScope } from './scope.js';

/**
 * @param {{
 *   id: string,
 *   focus: ReturnType<typeof import('./focus-manager.js').createFocusManager>,
 *   dispatch: (event: import('../contracts/events.js').UiEvent) => void,
 *   parent?: ReturnType<typeof createRegionHost> | null,
 *   parentId?: string | null,
 *   onActivate?: (path: string[]) => void,
 *   onDeactivate?: (path: string[]) => void,
 *   focusTarget?: { focus?: () => void } | null,
 * }} options
 */
export function createRegionHost(options = {}) {
  const {
    id,
    focus,
    dispatch,
    parent = null,
    onActivate,
    onDeactivate,
    focusTarget = null,
  } = options;

  if (!id) throw new Error('createRegionHost: 需要 id');
  if (!focus) throw new Error('createRegionHost: 需要 focus');
  if (typeof dispatch !== 'function') throw new Error('createRegionHost: 需要 dispatch(event)');

  const parentId = options.parentId !== undefined
    ? options.parentId
    : (parent?.id ?? null);

  const scope = createDisposeScope();
  /** @type {Set<{ destroy: () => void }>} */
  const children = new Set();
  const selfPath = parent ? [...parent.path, id] : [id];

  let destroyed = false;
  let active = focus.isActive(id);

  /* 结构位置登记在 scope 里：destroy 时自动从聚焦树摘掉。 */
  scope.add(focus.register({ id, parentId }));

  scope.add(
    focus.subscribe((nextPath) => {
      const isNowActive = nextPath[nextPath.length - 1] === id;
      if (isNowActive === active) return;
      active = isNowActive;

      if (isNowActive) {
        onActivate?.(nextPath.slice());
        /* 浏览器焦点由区域统一安排，组件只负责把自己交出来。 */
        focusTarget?.focus?.();
      } else {
        onDeactivate?.(nextPath.slice());
      }
    }),
  );

  /**
   * 把事件补上身份后交给统一入口。
   * 身份只在第一次转发时补；往上冒泡时不再改写，避免子区域的动作记到父区域头上。
   * @param {import('../contracts/events.js').UiEvent} event
   * @returns {boolean} 是否转发了
   */
  function emit(event) {
    if (destroyed) return false;
    if (!event || !event.type || typeof event.type !== 'string') return false;

    dispatch({
      ...event,
      kind: event.kind || 'mutate',
      regionId: event.regionId || id,
      regionPath: event.regionPath || selfPath.slice(),
    });
    return true;
  }

  /**
   * 挂一个子组件或子区域，返回“只摘这一个”的句柄。
   * @param {{ destroy: () => void }} child
   * @returns {() => void}
   */
  function registerChild(child) {
    if (!child || typeof child.destroy !== 'function') {
      throw new TypeError('region.registerChild: 子项需要 destroy()');
    }
    if (destroyed) {
      child.destroy();
      return () => {};
    }

    children.add(child);
    return function remove() {
      if (!children.has(child)) return;
      children.delete(child);
      child.destroy();
    };
  }

  /** 失焦但保留：不卸载，只是不能再改状态（靠 guard）。 */
  function isActive() {
    return !destroyed && focus.isActive(id);
  }

  function requestFocus() {
    if (destroyed) return false;
    /* 用户点到了这个区域：允许从兄弟区域直接切过来（见 FocusManager.activate）。 */
    return typeof focus.activate === 'function' ? focus.activate(id) : focus.push(id);
  }

  /**
   * 真正卸载：先卸子项，再统一销毁登记项（监听、订阅、定时器…）。
   * 单项报错不打断其余项，最后抛 AggregateError，方便测试发现泄漏。
   */
  function destroy() {
    if (destroyed) return;
    destroyed = true;

    const errors = [];
    for (const child of [...children]) {
      children.delete(child);
      try {
        child.destroy();
      } catch (error) {
        errors.push(error);
      }
    }

    try {
      scope.dispose();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, '区域销毁过程中出现多个错误');
  }

  return {
    id,
    parentId,
    get path() {
      return selfPath.slice();
    },
    emit,
    registerChild,
    isActive,
    requestFocus,
    destroy,
    /** 给区域内部登记监听/定时器/请求用。 */
    scope,
    get destroyed() {
      return destroyed;
    },
  };
}
