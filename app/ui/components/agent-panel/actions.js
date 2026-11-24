/* ===== 组件：底部动作条 =====
 * 能不能点由 props.canConfirm 决定（selector 算出来的能力），组件不判断业务。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

export function createActions({ document }) {
  const { el } = createDom(document);

  return function actions(initialProps, ctx) {
    let props = initialProps;
    const panelId = props.panelId || 'agentPanel';

    const cancel = el('button', {
      className: 'dlg-btn',
      attrs: { type: 'button' },
      on: {
        click: () => ctx.emit({ type: EVENTS.PANEL_CLOSE_CLICKED, payload: { id: panelId } }),
      },
    });
    const confirm = el('button', {
      className: 'dlg-btn primary',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (confirm.disabled) return;
          ctx.emit({ type: EVENTS.AGENT_CONFIRM_CLICKED, payload: {} });
        },
      },
    });
    const root = el('div', { className: 'dlg-actions' }, [cancel, confirm]);

    function render() {
      cancel.textContent = props.cancelLabel || '';
      confirm.textContent = props.confirmLabel || '';
      confirm.disabled = props.canConfirm !== true;
      cancel.disabled = props.busy === true;
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
