/* ===== 组件：语言滑块 =====
 * 两个选项原地切换；翻译与擦除动画不在这里（区域只发 settings.lang.submitted，
 * 落盘与写回由 settings 特效 / 控制器负责）。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

export function createLangToggle({ document }) {
  const { el, clear } = createDom(document);

  return function langToggle(initialProps, ctx) {
    let props = initialProps;
    const root = el('div', { className: 'lang-toggle' });

    function choose(value) {
      if (props.disabled) return;
      if (value === props.lang) return;
      ctx.emit({ type: EVENTS.SETTINGS_LANG_SUBMITTED, payload: { lang: value } });
    }

    function render() {
      root.className = `lang-toggle${props.lang === 'en' ? ' en' : ''}`;
      clear(root);

      root.appendChild(el('div', { className: 'lang-knob' }));
      for (const option of props.options || []) {
        const active = option.value === props.lang;
        root.appendChild(el('span', {
          className: `lang-opt${active ? ' active' : ''}`,
          text: option.label,
          attrs: {
            role: 'radio',
            tabindex: '0',
            'aria-checked': active ? 'true' : 'false',
            'data-lang': option.value,
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
