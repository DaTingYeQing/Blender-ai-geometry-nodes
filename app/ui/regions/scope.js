/* ===== 销毁作用域 =====
 * region.md「生命周期与取消」：请求、定时器、订阅、动画、观察器、DOM 监听
 * 都登记到区域自己的 scope 里，destroy 时统一收尾。
 *
 * 约定：
 *   - 后登记的先销毁（依赖关系通常是后建依赖先建）。
 *   - 可以单独撤销某一项：add() 的返回值就是“只撤销我”。
 *   - dispose() 幂等；已销毁后再 add，会立刻执行销毁函数，防止泄漏。
 *   - 某一项抛错不打断其余项，最后统一抛 AggregateError。
 */

export function createDisposeScope() {
  /** @type {Array<{ dispose: () => void, active: boolean }>} */
  const tasks = [];
  let disposed = false;

  /**
   * 登记一个销毁动作。
   * @param {() => void} dispose
   * @returns {() => void} 单独撤销这一项
   */
  function add(dispose) {
    if (typeof dispose !== 'function') {
      throw new TypeError('createDisposeScope.add: 需要一个函数');
    }
    if (disposed) {
      dispose();
      return () => {};
    }

    const entry = { dispose, active: true };
    tasks.push(entry);

    return function remove() {
      if (!entry.active) return;
      entry.active = false;
      const index = tasks.indexOf(entry);
      if (index >= 0) tasks.splice(index, 1);
      entry.dispose();
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    const errors = [];
    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      const entry = tasks[i];
      if (!entry.active) continue;
      entry.active = false;
      try {
        entry.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    tasks.length = 0;

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, '销毁过程中出现多个错误');
  }

  return {
    add,
    dispose,
    get size() {
      return tasks.length;
    },
    get disposed() {
      return disposed;
    },
  };
}
