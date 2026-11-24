/* ===== 组件：设置面板左栏导航 =====
 * 只画两个页签并上报点击；当前在哪一页由区域按状态算好传进来。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

export function createLogoNav({ document }) {
  const { el, clear } = createDom(document);

  return function logoNav(initialProps, ctx) {
    let props = initialProps;
    const panelId = props.panelId || 'logoPanel';
    const root = el('div', { className: 'm-left' });

    function render() {
      clear(root);
      for (const item of props.items || []) {
        const active = item.id === props.active;
        const node = el('div', {
          className: `nav-item${active ? ' active' : ''}`,
          text: item.label,
          attrs: {
            role: 'tab',
            tabindex: '0',
            'aria-selected': active ? 'true' : 'false',
            'data-panel': item.id,
          },
          on: {
            click: () => {
              if (props.disabled) return;
              ctx.emit({ type: EVENTS.PANEL_TAB_CLICKED, payload: { id: panelId, tab: item.id } });
            },
            keydown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              if (props.disabled) return;
              ctx.emit({ type: EVENTS.PANEL_TAB_CLICKED, payload: { id: panelId, tab: item.id } });
            },
          },
        });
        root.appendChild(node);
      }
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
