/* ===== 组件层最小 DOM 工具 =====
 * 组件只负责画，所以这里只做“建节点 / 清空”两件小事。
 * document 由组装根注入，测试里可以给一个假的，组件本身不读全局。
 */

/**
 * @param {Document} document
 */
export function createDom(document) {
  /**
   * @param {string} tag
   * @param {{
   *   className?: string,
   *   text?: string | number,
   *   attrs?: Record<string, string | number | boolean | null | undefined>,
   *   dataset?: Record<string, string | number>,
   *   style?: Record<string, string>,
   *   on?: Record<string, (event: any) => void>,
   * }} [options]
   * @param {Array<Node | string | null | false | undefined> | Node | string} [children]
   */
  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);

    if (options.className) node.className = options.className;
    if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);

    if (options.attrs) {
      for (const [name, value] of Object.entries(options.attrs)) {
        if (value === undefined || value === null || value === false) continue;
        node.setAttribute(name, value === true ? '' : String(value));
      }
    }
    if (options.dataset) {
      for (const [name, value] of Object.entries(options.dataset)) {
        node.dataset[name] = String(value);
      }
    }
    if (options.style) Object.assign(node.style, options.style);
    if (options.on) {
      for (const [type, handler] of Object.entries(options.on)) {
        node.addEventListener(type, handler);
      }
    }

    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === undefined || child === null || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  return { el, clear };
}
