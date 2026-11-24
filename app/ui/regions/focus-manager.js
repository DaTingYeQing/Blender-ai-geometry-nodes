/* ===== FocusManager（总聚焦人）=====
 * region.md 5.1.3：全局只有一个，唯一有权决定“现在谁能改”。
 * 它是一份聚焦栈（路径），不理解业务、不碰 DOM。
 *
 * 规则：
 *   - 路径从根开始，如 ['app', 'workspace', 'canvas']。
 *   - 只有路径末端的区域算激活；子区域不能越过父区域直接激活。
 *   - 注册表只记录结构（谁是谁的爹），聚焦栈单独维护。
 *   - 区域销毁时自动从栈里摘掉，并截断它下面的所有后代。
 */

/**
 * @param {{ rootId?: string }} [options]
 */
export function createFocusManager({ rootId = 'app' } = {}) {
  /** @type {Map<string, { id: string, parentId: string | null }>} */
  const regions = new Map();
  /** 聚焦栈，第 0 项永远是根。 */
  let path = [rootId];
  /** @type {Set<(path: string[]) => void>} */
  const listeners = new Set();

  function snapshot() {
    return path.slice();
  }

  function notify(previous) {
    for (const listener of [...listeners]) {
      try {
        listener(snapshot(), previous.slice());
      } catch {
        /* 一个记录员坏了，不该拖垮聚焦本身。 */
      }
    }
  }

  function setPath(next) {
    if (next.length === path.length && next.every((id, i) => id === path[i])) return false;
    const previous = path;
    path = next;
    notify(previous);
    return true;
  }

  /**
   * 登记一个区域的结构位置。
   * @param {{ id: string, parentId?: string | null }} region
   * @returns {() => void} 注销；会连同子孙一起摘掉
   */
  function register({ id, parentId = null } = {}) {
    if (!id) throw new Error('focus.register: 需要 id');
    if (regions.has(id)) throw new Error(`focus.register: 区域 id 重复：${id}`);
    if (parentId && !regions.has(parentId)) {
      throw new Error(`focus.register: 父区域不存在：${parentId}`);
    }

    regions.set(id, { id, parentId });

    return function unregister() {
      if (!regions.has(id)) return;

      /* 先收集自己和所有后代。 */
      const removed = new Set();
      const stack = [id];
      while (stack.length) {
        const current = stack.pop();
        removed.add(current);
        for (const region of regions.values()) {
          if (region.parentId === current && !removed.has(region.id)) stack.push(region.id);
        }
      }

      /* 聚焦路径里只要碰上了被摘掉的区域，就截断到它的父级。 */
      const cutIndex = path.findIndex((rid) => removed.has(rid));
      for (const rid of removed) regions.delete(rid);

      if (cutIndex >= 0) setPath(path.slice(0, Math.max(1, cutIndex)));
    };
  }

  /** 当前聚焦末端是不是它。 */
  function isActive(regionId) {
    return path[path.length - 1] === regionId;
  }

  /**
   * 请求把焦点压到某个区域。父区域不在路径末端时直接拒绝。
   * @returns {boolean} 是否真的改变了路径
   */
  function push(regionId) {
    const region = regions.get(regionId);
    if (!region) throw new Error(`focus.push: 未注册的区域：${regionId}`);

    if (isActive(regionId)) return false;

    /* 已在路径中间：等于回退到它。 */
    const existing = path.indexOf(regionId);
    if (existing >= 0) return setPath(path.slice(0, existing + 1));

    if (region.parentId && path[path.length - 1] !== region.parentId) return false;

    return setPath([...path, regionId]);
  }

  /**
   * 把焦点交给某个区域，允许从“兄弟区域”直接切过去：
   * 先退回到它最近的、已在路径上的祖先，再沿注册结构补到它。
   * 这和 push 的区别：push 只用于“继续往下钻”，activate 用于“用户点到了另一个区域”。
   * 结构上的父子关系仍由注册表保证，不会凭空造出一条不存在的路径。
   * @returns {boolean} 是否真的改变了路径
   */
  function activate(regionId) {
    const region = regions.get(regionId);
    if (!region) throw new Error(`focus.activate: 未注册的区域：${regionId}`);

    if (isActive(regionId)) return false;

    /* 已经在路径中间：退回到它，和 push 一致。 */
    const existing = path.indexOf(regionId);
    if (existing >= 0) return setPath(path.slice(0, existing + 1));

    const chain = [];
    let current = region;
    let anchorIndex = -1;
    while (current) {
      chain.unshift(current.id);
      const index = path.indexOf(current.id);
      if (index >= 0) {
        anchorIndex = index;
        break;
      }
      current = current.parentId ? regions.get(current.parentId) : null;
    }

    /* 路径里连一个祖先都没有（正常只有根，且根永远在路径上）。 */
    if (!current) return false;

    return setPath([
      ...path.slice(0, anchorIndex + 1),
      ...chain.slice(chain.indexOf(current.id) + 1),
    ]);
  }

  /**
   * 弹出聚焦。不带 id 弹末端；带 id 弹回该区域（含）。
   * @returns {boolean} 是否真的改变了路径
   */
  function pop(regionId) {
    const index = regionId === undefined ? path.length - 1 : path.indexOf(regionId);
    if (index <= 0) return false;   // 根不能弹，未知 id 也不弹
    return setPath(path.slice(0, index));
  }

  /**
   * @param {(path: string[], previous: string[]) => void} listener
   * @returns {() => void}
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('focus.subscribe: 需要函数');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    register,
    path: snapshot,
    isActive,
    push,
    activate,
    pop,
    subscribe,
    has: (regionId) => regions.has(regionId),
  };
}
