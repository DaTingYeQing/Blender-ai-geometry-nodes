/* ===== UI：手动保存按钮 =====
 * 工作区右上角一个 save 标签：
 *   save（有改动时边框变橙）→ 点一下 → saving… → done（绿）/ failed（红）
 * 退出工作区、关闭软件前都用同一个 flush 兜底。
 */

import { toast } from './core/dom.js';
import { t } from './core/i18n.js';
import { confirmDialog } from './core/confirm.js';

export function mountSaveButton({ store, saver }) {
  const btn = document.getElementById('saveBtn');
  if (!btn) return;
  const textEl = btn.querySelector('.save-text');

  btn.addEventListener('click', async () => {
    if (btn.dataset.state === 'saving') return;
    const ok = await saver.flush();
    if (!ok) toast(t('保存失败'));
  });

  /* 主进程在关窗前把情况发回来，这里用自绘弹窗问完再回复。 */
  window.piFlow?.onCloseRequest?.((info = {}) => {
    handleCloseRequest(Number(info.running) || 0, Boolean(info.dirty));
  });

  async function handleCloseRequest(running, dirty) {
    if (running) {
      const choice = await confirmDialog({
        title: t('还有节点在运行'),
        message: t('现在关闭会中断 {n} 个正在运行的任务，并可能导致错误。', { n: running }),
        buttons: dirty
          ? [t('保存并关闭'), t('仍然关闭'), t('取消')]
          : [t('仍然关闭'), t('取消')],
      });
      if (!dirty) {
        window.piFlow?.respondClose?.(choice === 0 ? 'close' : 'cancel');
        return;
      }
      if (choice === 2) { window.piFlow?.respondClose?.('cancel'); return; }
      if (choice === 1) { window.piFlow?.respondClose?.('close'); return; }
      return saveAndClose();
    }

    if (dirty) {
      const choice = await confirmDialog({
        title: t('还有改动没保存'),
        message: t('当前流程有改动还没保存，要先保存吗？'),
        buttons: [t('保存并关闭'), t('不保存'), t('取消')],
      });
      if (choice === 2) { window.piFlow?.respondClose?.('cancel'); return; }
      if (choice === 1) { window.piFlow?.respondClose?.('close'); return; }
      return saveAndClose();
    }

    window.piFlow?.respondClose?.('close');
  }

  async function saveAndClose() {
    const ok = await saver.flush();
    if (!ok) {
      toast(t('保存失败，窗口先不关'));
      window.piFlow?.respondClose?.('cancel');
      return;
    }
    window.piFlow?.respondClose?.('close');
  }

  let prevState = null;
  let prevLang = null;
  let prevEntered = null;

  function render(state) {
    const entered = state.business.workspace.entered;
    if (entered !== prevEntered) {
      prevEntered = entered;
      btn.hidden = !entered;
      /* 进/出工作区都把上一份的绿/红清掉：
       * 离开时用户已经做过"保存 / 不保存"的选择，不该再让关窗流程重复拦。 */
      saver.reset();
    }

    const saveState = state.view.saveState || 'idle';
    const lang = state.business.settings.lang === 'en' ? 'en' : 'zh';
    /* 语言切换时状态没变，也要重写一次文字。 */
    if (saveState === prevState && lang === prevLang) return;
    prevState = saveState;
    prevLang = lang;

    btn.dataset.state = saveState;
    textEl.textContent = saveState === 'saved'
      ? t('成功')
      : saveState === 'failed'
        ? t('失败')
        : t('保存');
    btn.title = saveState === 'dirty' ? t('有未保存的改动') : t('保存流程');
    /* 只有真正落盘成功才告诉主进程"干净了"；失败仍然算脏。 */
    window.piFlow?.setDirty?.(
      saveState === 'dirty' || saveState === 'saving' || saveState === 'failed',
    );
  }

  store.subscribe(render);
}
