/* ===== 组件：名称输入框 =====
 * 输入即上报；不校验、不 trim、不决定能不能提交。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

export function createNameField({ document }) {
  const { el } = createDom(document);

  return function nameField(initialProps, ctx) {
    let props = initialProps;

    const input = el('input', {
      className: 'dlg-input agent-name',
      attrs: {
        type: 'text',
        maxlength: '40',
        placeholder: props.placeholder || '',
      },
      on: {
        input: () => {
          ctx.emit({ type: EVENTS.AGENT_NAME_CHANGED, payload: { name: input.value } });
        },
      },
    });

    const labelText = el('span', { className: 'agent-label', text: props.label || '' });
    const label = el('label', { className: 'agent-field' }, [labelText, input]);

    function render() {
      /* 只在真的不同才写，避免打字时光标跳回行首 */
      if (input.value !== props.value) input.value = props.value ?? '';
      input.disabled = props.disabled === true;
      if (props.placeholder) input.setAttribute('placeholder', props.placeholder);
      /* 文案也要能更新：换语言时不能只在挂载那一次翻译。 */
      if (labelText.textContent !== (props.label || '')) labelText.textContent = props.label || '';
    }

    render();

    return {
      el: label,
      update(next) {
        props = next;
        render();
      },
      focus() {
        input.focus?.();
      },
      destroy() {
        label.remove?.();
      },
    };
  };
}
