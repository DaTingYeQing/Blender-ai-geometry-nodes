/* ===== 组件契约 =====
 * component.md：组件只根据 props 渲染 DOM，通过 ctx.emit 发事件。
 * 只有类型，运行时不产生代码。
 */

/**
 * @typedef {Object} ComponentContext
 * @property {(event: import('./events.js').UiEvent) => void} emit
 * @property {() => void} requestFocus
 */

/**
 * @typedef {Object} ComponentHandle
 * @property {(props: object) => void} update
 * @property {() => void} destroy
 */

/**
 * 工厂返回 { el } 加上 update / destroy；组件可以额外暴露方法（如 focus）。
 * @typedef {(props: object, ctx: ComponentContext) => ({ el: HTMLElement } & ComponentHandle)} ComponentFactory
 */

/**
 * 节点。带 children 的节点是“容器”：注册表递归渲染后把子节点按序追加到
 * 组件根元素末尾；接受 children 的组件不要在 update 里 replaceChildren 根元素。
 * 未知 type 是终点，不再递归它的 children。
 * 边界：props 只能是数据（字符串/数字/布尔/数组/对象），注册表不会把它当 HTML 解析；
 * 新 UI 层不出现 innerHTML / eval / document.write（架构测试守着）。
 * 需要富文本时由前端组件自己用受控的 Markdown 渲染器处理，后端不给 HTML。
 *
 * @typedef {Object} ViewNode
 * @property {string} type
 * @property {object} [props]
 * @property {ViewNode[]} [children]
 * @property {string} [key]
 */

/**
 * @typedef {Object} ComponentRegistry
 * @property {(type: string, factory: ComponentFactory) => void} register
 * @property {(node: ViewNode, ctx: ComponentContext) => ({ el: HTMLElement } & ComponentHandle)} render
 * @property {(node: ViewNode, ctx: ComponentContext) => ({ el: HTMLElement, update: (node: ViewNode) => void, destroy: () => void })} renderTree
 * @property {(type: string) => boolean} has
 */

export {};
