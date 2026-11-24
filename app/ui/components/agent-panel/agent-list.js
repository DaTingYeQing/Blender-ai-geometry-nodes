/* ===== 组件：现有 agent 列表 =====
 * 颜色由 props 提供（前端按序分配），组件不查主题、不读全局。
 * 选中与否也由 props 决定，组件只上报点击。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

const EMPTY_COLOR = { bg: 'transparent', border: 'transparent', text: 'inherit' };

export function createAgentList({ document }) {
  const { el, clear } = createDom(document);

  return function agentList(initialProps, ctx) {
    let props = initialProps;

    const list = el('div', { className: 'agent-picker-list' });
    const root = el('div', { className: 'agent-picker' }, [list]);

    function render() {
      root.hidden = props.visible === false;
      clear(list);

      const agents = props.agents || [];
      if (!agents.length) {
        list.appendChild(
          el('div', { className: 'agent-picker-empty', text: props.emptyText || '' }),
        );
        return;
      }

      for (const agent of agents) {
        const color = agent.color || EMPTY_COLOR;
        const selected = agent.id === props.selectedId;
        const card = el('div', {
          className: `agent-card${selected ? ' selected' : ''}`,
          attrs: { 'data-agent-id': agent.id, role: 'button', tabindex: '0' },
          dataset: { agentId: agent.id },
          style: {
            borderColor: color.border,
            background: selected ? color.bg : '',
            color: selected ? color.text : '',
          },
          on: {
            click: () => {
              if (props.disabled) return;
              ctx.emit({ type: EVENTS.AGENT_CARD_CLICKED, payload: { agentId: agent.id } });
            },
            keydown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              if (props.disabled) return;
              ctx.emit({ type: EVENTS.AGENT_CARD_CLICKED, payload: { agentId: agent.id } });
            },
          },
        }, [
          el('span', {
            className: 'agent-card-dot',
            style: { background: selected ? color.text : color.bg },
          }),
          el('span', { className: 'agent-card-name', text: agent.name }),
        ]);
        list.appendChild(card);
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
