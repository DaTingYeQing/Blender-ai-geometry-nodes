/* ===== 组件：状态/错误提示 =====
 * 只有文案和色调；显示什么、算不算错误都由外部决定。
 */

import { createDom } from '../dom.js';

export function createStatus({ document }) {
  const { el } = createDom(document);

  return function status(initialProps) {
    let props = initialProps;
    const root = el('div', { className: 'agent-status', attrs: { role: 'status' } });

    function render() {
      const text = props.message || '';
      root.textContent = text;
      root.hidden = !text;
      root.className = `agent-status${props.tone ? ` ${props.tone}` : ''}`;
    }

    render();

    return {
      el: root,
      update(next) {
        props = next;
        render();
      },
      destroy() {
        root.remove?.();
      },
    };
  };
}
