/* ===== 组件：工具多选 =====
 * 选中状态由外部传入（props.selected），组件只负责画和上报点击。
 * 名字和说明都来自 props；组件不认识工具语义。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

export function createToolPicker({ document }) {
  const { el, clear } = createDom(document);

  return function toolPicker(initialProps, ctx) {
    let props = initialProps;
    const label = el('span', { className: 'agent-label', text: props.label || '' });
    const box = el('div', { className: 'agent-tools' });
    const root = el('div', { className: 'agent-field agent-field-grow' }, [label, box]);

    /** @type {Map<string, HTMLElement>} */
    let chips = new Map();
    let chipsKey = null;
    let emptyEl = null;

    function buildChips() {
      clear(box);
      chips = new Map();
      emptyEl = null;

      for (const tool of props.tools || []) {
        const chip = el('button', {
          className: 'tool-chip',
          attrs: { type: 'button', 'aria-pressed': 'false', 'data-tool': tool.name },
          on: {
            click: () => {
              if (props.disabled) return;   // 允许与否由外部决定
              ctx.emit({ type: EVENTS.AGENT_TOOL_TOGGLED, payload: { tool: tool.name } });
            },
          },
        }, [
          el('span', { className: 'tool-chip-name', text: tool.name }),
          tool.hint ? el('span', { className: 'tool-chip-hint', text: tool.hint }) : null,
        ]);
        chips.set(tool.name, chip);
        box.appendChild(chip);
      }

      if (!chips.size) {
        emptyEl = el('div', { className: 'agent-tools-empty', text: props.emptyText || '' });
        box.appendChild(emptyEl);
      }
    }

    function render() {
      label.textContent = props.label || '';

      const key = (props.tools || []).map((tool) => tool.name).join('|');
      if (key !== chipsKey) {
        chipsKey = key;
        buildChips();
      }

      const selected = Array.isArray(props.selected) ? props.selected : [];
      for (const [name, chip] of chips) {
        const active = selected.includes(name);
        chip.classList.toggle('active', active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        chip.disabled = props.disabled === true;
      }

      if (!chips.size && emptyEl) emptyEl.textContent = props.emptyText || '';
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
