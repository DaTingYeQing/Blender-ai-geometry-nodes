/* ===== 组件注册表 =====
 * component.md：组件通过注册表创建，不互相 import 具体实现。
 *   registry.render(node, ctx)       一次创建（children 静态递归，返回显隐时的快照句柄）
 *   registry.renderTree(node, ctx)   可增量更新（按 key 复用，子节点重排不错位）
 *
 * 未知类型不抛错、不执行任何内容，只渲染一个明确的降级占位并上报，
 * 这样后端多给了新描述也不会把整个界面打断。
 */

/**
 * @param {{
 *   document: Document,
 *   onUnknown?: (type: string) => void,
 *   onError?: (type: string, error: unknown) => void,
 * }} options
 */
export function createComponentRegistry({ document, onUnknown, onError } = {}) {
  if (!document) throw new Error('createComponentRegistry: 需要 document');

  /** @type {Map<string, import('../contracts/components.js').ComponentFactory>} */
  const factories = new Map();

  /* 组件坏了不能把区域一起带走：上报后换成占位，后续 update 不再重试。 */
  function report(type, error) {
    try {
      onError?.(type, error);
    } catch {
      /* 记录员自己坏了，不影响降级。 */
    }
  }

  function errorPlaceholder(type, error) {
    report(type, error);
    const el = document.createElement('div');
    el.className = 'component-error';
    el.setAttribute('role', 'alert');
    el.setAttribute('data-component', type);
    el.textContent = `组件渲染失败：${type}`;

    return {
      el,
      update() {},
      destroy() {
        el.remove?.();
      },
    };
  }

  function showInside(el, type) {
    el.className = 'component-error';
    el.setAttribute('role', 'alert');
    el.setAttribute('data-component', type);
    el.replaceChildren(document.createTextNode(`组件渲染失败：${type}`));
  }

  /** 把 update 包起来：一次抛错就地降级，之后静默跳过。 */
  function withBoundary(handle, type) {
    let broken = false;

    return {
      /* 组件自己的额外能力（如 focus）原样转发，只替换 update / destroy。 */
      ...handle,
      el: handle.el,
      update(props) {
        if (broken || typeof handle.update !== 'function') return;
        try {
          handle.update(props);
        } catch (error) {
          broken = true;
          report(type, error);
          showInside(handle.el, type);
        }
      },
      destroy() {
        try {
          handle.destroy?.();
        } catch (error) {
          report(type, error);
        }
      },
    };
  }

  function register(type, factory) {
    if (!type || typeof type !== 'string') throw new Error('registry.register: 需要 type');
    if (typeof factory !== 'function') throw new Error(`registry.register: ${type} 缺少工厂函数`);
    if (factories.has(type)) throw new Error(`registry.register: 组件重复注册：${type}`);
    factories.set(type, factory);
  }

  /** 只渲染节点本身（不处理 children）。node 非法时抛错，由上层决定怎么降级。 */
  function renderShallow(node, ctx) {
    if (!node || typeof node.type !== 'string' || !node.type) {
      throw new Error('registry.render: 需要 { type }');
    }

    const factory = factories.get(node.type);
    if (factory) {
      let handle;
      try {
        handle = factory(node.props || {}, ctx);
      } catch (error) {
        return errorPlaceholder(node.type, error);
      }
      if (!handle || !handle.el) {
        return errorPlaceholder(node.type, new Error('工厂没有返回 { el }'));
      }
      return withBoundary(handle, node.type);
    }

    onUnknown?.(node.type);

    const el = document.createElement('div');
    el.className = 'component-unknown';
    el.textContent = `未知组件：${node.type}`;

    return {
      el,
      update() {},
      destroy() {
        el.remove?.();
      },
    };
  }

  /**
   * 容器节点：把 node.children 递归渲染后追加到组件根元素末尾。
   * 约定：接受 children 的组件不要在 update 里 replaceChildren 自己的根，
   * 否则子节点会被一起清掉（需要槽位时自行留一个子容器）。
   */
  function withChildren(handle, node, ctx) {
    const kids = node.children;
    if (kids === undefined || kids === null) return handle;
    if (!Array.isArray(kids)) {
      report(node.type, new Error('children 必须是数组'));
      return handle;
    }
    if (kids.length === 0) return handle;

    const children = kids.map((child, index) => {
      try {
        return render(child, ctx);
      } catch (error) {
        return errorPlaceholder(`${node.type}[${index}]`, error);
      }
    });

    for (const child of children) handle.el.appendChild?.(child.el);

    return {
      ...handle,
      el: handle.el,
      update(props) {
        handle.update?.(props);
      },
      destroy() {
        for (const child of children) {
          try {
            child.destroy?.();
          } catch (error) {
            report(node.type, error);
          }
        }
        handle.destroy?.();
      },
    };
  }

  function render(node, ctx) {
    return withChildren(renderShallow(node, ctx), node, ctx);
  }

  /* ---------------- keyed reconciliation ---------------- */

  /**
   * @typedef {{
   *   node: any, type: string, key: string | null,
   *   handle: { el: HTMLElement } & import('../contracts/components.js').ComponentHandle,
   *   children: Entry[],
   * }} Entry
   */

  function mountEntry(node, ctx) {
    const type = typeof node?.type === 'string' ? node.type : '';
    let handle;
    if (!type) handle = errorPlaceholder('(invalid)', new Error('节点缺少 type'));
    else handle = renderShallow(node, ctx);

    /** @type {Entry} */
    const entry = { node, type: type || '(invalid)', key: node?.key ?? null, handle, children: [] };

    /* 未知类型是终点：降级占位不再递归它的 children。 */
    if (!type || !factories.has(type)) return entry;

    const kids = node?.children;
    if (kids === undefined || kids === null) return entry;
    if (!Array.isArray(kids)) {
      report(type, new Error('children 必须是数组'));
      return entry;
    }

    entry.children = kids.map((child) => mountEntry(child, ctx));
    for (const child of entry.children) handle.el.appendChild?.(child.handle.el);
    return entry;
  }

  function destroyEntry(entry) {
    for (const child of entry.children) destroyEntry(child);
    try {
      entry.handle.destroy?.();
    } catch (error) {
      report(entry.type, error);
    }
  }

  function sameShape(entry, node) {
    const type = typeof node?.type === 'string' ? node.type : '(invalid)';
    const key = node?.key ?? null;
    return type === entry.type && key === entry.key;
  }

  function diffChildren(previous, nodes, ctx) {
    const nextNodes = Array.isArray(nodes) ? nodes : [];
    const used = previous.map(() => false);
    const next = [];

    /* 有 key 的按 key 匹配；无 key 的按“同类型、按序第一个未用”匹配。 */
    const byKey = new Map();
    previous.forEach((entry, index) => {
      if (entry.key !== null) byKey.set(entry.key, index);
    });

    for (const node of nextNodes) {
      const key = node?.key ?? null;
      let index = -1;
      if (key !== null && byKey.has(key)) {
        index = byKey.get(key);
        byKey.delete(key);
      } else {
        index = previous.findIndex(
          (entry, i) => !used[i] && entry.key === null && entry.type === (node?.type || '(invalid)'),
        );
      }

      if (index >= 0) {
        used[index] = true;
        next.push(updateEntry(previous[index], node, ctx));
      } else {
        next.push(mountEntry(node, ctx));
      }
    }

    previous.forEach((entry, index) => {
      if (!used[index]) destroyEntry(entry);
    });

    return next;
  }

  function updateEntry(entry, node, ctx) {
    if (!sameShape(entry, node)) {
      destroyEntry(entry);
      return mountEntry(node, ctx);
    }

    entry.node = node;
    entry.handle.update?.(node.props || {});

    const kids = node.children;
    if (kids === undefined || kids === null) {
      for (const child of entry.children) destroyEntry(child);
      entry.children = [];
      return entry;
    }
    if (!Array.isArray(kids)) {
      report(entry.type, new Error('children 必须是数组'));
      return entry;
    }

    entry.children = diffChildren(entry.children, kids, ctx);

    /* 顺序变了才重排，避免无谓的 DOM 移动把 CSS 动画重放。 */
    const el = entry.handle.el;
    const current = el.children || [];
    const same = current.length === entry.children.length
      && entry.children.every((child, i) => current[i] === child.handle.el);
    if (!same) {
      for (const child of entry.children) el.appendChild?.(child.handle.el);
    }
    return entry;
  }

  /**
   * 可增量更新的渲染入口：同 type + 同 key 复用组件实例，只 update props；
   * key/type 变了就销毁重建；子节点按 key 重排、增删。
   * @param {import('../contracts/components.js').ViewNode} node
   * @param {import('../contracts/components.js').ComponentContext} ctx
   */
  function renderTree(node, ctx) {
    let entry = mountEntry(node, ctx);

    return {
      get el() {
        return entry.handle.el;
      },
      type: entry.type,
      key: entry.key,
      update(nextNode) {
        entry = updateEntry(entry, nextNode, ctx);
      },
      destroy() {
        destroyEntry(entry);
      },
    };
  }

  return {
    register,
    render,
    renderTree,
    has: (type) => factories.has(type),
  };
}
