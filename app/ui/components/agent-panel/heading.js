/* ===== 组件：标题 ===== */

import { createDom } from '../dom.js';

export function createHeading({ document }) {
  const { el } = createDom(document);

  return function heading(initialProps) {
    let props = initialProps;
    const root = el('div', { className: props.className || 'dlg-title', text: props.text || '' });

    return {
      el: root,
      update(next) {
        props = next;
        root.textContent = props.text || '';
        if (props.className) root.className = props.className;
      },
      destroy() {
        root.remove?.();
      },
    };
  };
}
