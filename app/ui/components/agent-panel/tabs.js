/* ===== 组件：面板页签 =====
 * 只画页签，不判断当前该是哪一页——active 由 selectors 算好传进来。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

export function createAgentTabs({ document }) {
  const { el, clear } = createDom(document);

  return function agentTabs(initialProps, ctx) {
    let props = initialProps;
    const root = el('div', { className: 'agent-tab-items' });
    const panelId = props.panelId || 'agentPanel';

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
            'data-agent-tab': item.id,
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
