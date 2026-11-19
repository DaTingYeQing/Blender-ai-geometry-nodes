/* ===== 状态树：全应用唯一可写的数据源 =====
 * 两块分开管：
 *   business —— 业务状态。可序列化、能跨 API、将来要落库。
 *               只有 business/ 下的 handler 能写（经 ctx.commit）。
 *   view     —— 界面状态。缩放比例、面板开没开、导航停在哪页。
 *               引擎私有，不进 API，UI 组件自己管。
 *
 * 为什么必须分开：业务状态如果混进"面板是否打开"这种字段，
 * 业务层迟早要关心"动画播完没有"，解耦就白做了。
 *
 * 订阅模型：commit() 后把所有订阅者跑一遍。组件自己负责增量更新，
 * 不要每次都重建 DOM —— 重建会把过渡动画的起点丢掉。
 */

export function createStore(initial) {
  let state = initial;
  const subs = new Set();

  function getState() {
    return state;
  }

  /**
   * 写状态。
   * @param {(state) => void} mutator 直接改传入的对象
   * @param {{silent?: boolean}} [opts] silent = 只改不广播（画布平移缩放用，
   *        那种每帧都变的值广播出去会让所有组件白重绘一遍）
   */
  function commit(mutator, opts = {}) {
    mutator(state);
    if (opts.silent) return;
    for (const fn of subs) fn(state);
  }

  /** 订阅。注册时立即调用一次，组件不必自己再手动渲染首帧。返回退订函数。 */
  function subscribe(fn) {
    subs.add(fn);
    fn(state);
    return () => subs.delete(fn);
  }

  /**
   * 只广播不改状态。
   * 用于"操作失败了，把 DOM 拉回状态里的样子" —— 这时状态本来就是对的，
   * 只是刚才手势层绕过状态直接改了 DOM。
   */
  function notify() {
    for (const fn of subs) fn(state);
  }

  return { getState, commit, subscribe, notify };
}
