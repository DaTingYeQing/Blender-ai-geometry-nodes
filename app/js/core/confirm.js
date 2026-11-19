/* ===== UI：通用确认框 =====
 * 自绘弹窗，不用 window.confirm —— 系统白框和深色界面不搭。
 * 返回 Promise<number>，值是按钮下标；第一个按钮当主按钮。
 */

import { t } from './i18n.js';

export function confirmDialog({ title, message = '', buttons = [t('取消'), t('确定')] }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal confirm-modal';

    const titleEl = document.createElement('p');
    titleEl.className = 'confirm-title';
    titleEl.textContent = title;

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    function close(index) {
      overlay.remove();
      resolve(index);
    }

    buttons.forEach((label, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'confirm-btn' + (index === 0 ? ' primary' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => close(index));
      actions.appendChild(btn);
    });

    modal.append(titleEl);
    if (message) {
      const textEl = document.createElement('p');
      textEl.className = 'confirm-text';
      textEl.textContent = message;
      modal.append(textEl);
    }
    modal.append(actions);
    overlay.append(modal);
    document.body.appendChild(overlay);
  });
}
