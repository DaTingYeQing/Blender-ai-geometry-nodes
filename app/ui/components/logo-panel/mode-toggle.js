/* ===== 组件：模式滑块（团队 / 单人）=====
 * 只改本地选择；单人模式的终端在“进入工作区”时才启动。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

export function createModeToggle({ document }) {
  const { el, clear } = createDom(document);

  return function modeToggle(initialProps, ctx) {
    let props = initialProps;
    const root = el('div', { className: 'lang-toggle mode-toggle' });

    function choose(value) {
      if (props.disabled) return;
      if (value === props.mode) return;
      ctx.emit({ type: EVENTS.SETTINGS_MODE_CHANGED, payload: { mode: value } });
    }

    function render() {
      root.className = `lang-toggle mode-toggle${props.mode === 'solo' ? ' en' : ''}`;
      clear(root);

      root.appendChild(el('div', { className: 'lang-knob' }));
      for (const option of props.options || []) {
        const active = option.value === props.mode;
        root.appendChild(el('span', {
          className: `lang-opt${active ? ' active' : ''}`,
          text: option.label,
          attrs: {
            role: 'radio',
            tabindex: '0',
            'aria-checked': active ? 'true' : 'false',
            'data-mode': option.value,
          },
          on: {
            click: () => choose(option.value),
            keydown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              choose(option.value);
            },
          },
        }));
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
