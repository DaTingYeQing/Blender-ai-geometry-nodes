/* ===== 组装根：屏幕生命周期 =====
 * “换屏”是应用里唯一需要整棵子树作废的边界：旧屏幕的区域树会被销毁，
 * 它发出去的请求也就没人接收了。状态层早已按 requestId 丢弃晚到的回包，
 * 这里再往前一步：把在途传输真正中止掉，不让它白占连接。
 *
 * 屏幕键取三件事（缺一不可）：
 *   - route.name / route.params.workspaceId：路由表规定的屏幕；
 *   - workspace.entered.workspaceId：团队模式下“已进入”的那个工作区；
 *   - settings.mode：solo / team 切换会整份清空画布，等同于换屏。
 * 只比较字符串键，不读读模型、不改状态；读模型没实现 abortScreenScoped 就跳过。
 *
 * 结果事件仍然由状态层按 requestId 丢弃 —— 这里是省传输，不是新的业务真相。
 */

/**
 * @param {import('../ui/contracts/state.js').UiState} state
 * @returns {string}
 */
export function screenKeyOf(state) {
  const route = state?.route || {};
  const params = route.params || {};
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
  const entered = state?.workspace?.entered?.workspaceId || '';
  const mode = state?.settings?.mode === 'solo' ? 'solo' : 'team';
  return `${route.name || ''}|${workspaceId}|${entered}|${mode}`;
}

/**
 * 订阅 store，屏幕键变化时让各读模型停掉屏幕级在途请求。
 *
 * @param {{
 *   kernel: { store: { getState: () => any, subscribe: (fn: (state: any, previous: any) => void) => () => void } },
 *   targets: Array<{ abortScreenScoped?: () => unknown }>,
 * }} options
 */
export function mountScreenAbort({ kernel, targets = [] }) {
  if (!kernel?.store || typeof kernel.store.subscribe !== 'function') {
    throw new Error('mountScreenAbort: 需要 kernel.store');
  }

  const list = Array.isArray(targets)
    ? targets.filter((target) => typeof target?.abortScreenScoped === 'function')
    : [];

  let lastKey = screenKeyOf(kernel.store.getState());
  let destroyed = false;

  function abortAll() {
    for (const target of list) {
      try {
        target.abortScreenScoped();
      } catch {
        /* 一个读模型收尾失败不能影响换屏。 */
      }
    }
  }

  const unsubscribe = kernel.store.subscribe((state) => {
    if (destroyed) return;
    const key = screenKeyOf(state);
    if (key === lastKey) return;
    lastKey = key;
    abortAll();
  });

  return {
    /** 卸载：停订阅；在飞请求交给浏览器，不再主动动读模型。 */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
    },
  };
}
