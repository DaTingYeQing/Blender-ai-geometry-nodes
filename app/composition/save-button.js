/* ===== 组装根：手动保存按钮 =====
 * 保存按钮只发 workspace.save.clicked；真正落盘仍由旧流程保存器完成。
 * 这里负责三件宿主相关的事：
 *   1. 调 saver.flush()，成功/失败回成结果事件；
 *   2. 进入/离开工作区时 saver.reset()，避免上一份的绿/红状态串场；
 *   3. 主进程关窗询问（piFlow.onCloseRequest）仍走同一个 flush。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createSaveButtonRegion } from '../ui/regions/save-button.js';
import { confirmDialog } from '../ui/platform/confirm.js';

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   saver: { flush: () => Promise<boolean>, reset: () => void },
 *   document?: Document,
 *   window?: Window,
 *   translate?: (text: string) => string,
 *   toast?: (message: string) => void,
 * }} options
 */
export function mountSaveButtonPilot({
  kernel,
  saver,
  document: doc = globalThis.document,
  window: win = doc?.defaultView ?? globalThis,
  translate = (text) => text,
  toast = (message) => console.warn('[保存]', message),
}) {
  if (!kernel) throw new Error('mountSaveButtonPilot: 需要 kernel');
  if (typeof saver?.flush !== 'function') throw new Error('mountSaveButtonPilot: 需要 saver.flush()');
  if (!doc) throw new Error('mountSaveButtonPilot: 需要 document');

  const { store, focus, root, dispatch } = kernel;
  const t = translate;

  const region = createSaveButtonRegion({
    parent: root,
    focus,
    dispatch,
    store,
    document: doc,
    translate: t,
  });

  /* ---------- 保存器状态 → 宿主（关窗兜底） ---------- */

  const DIRTY_STATES = new Set(['dirty', 'saving', 'failed']);
  let prevStatus = null;
  let prevEntered = null;

  const stopStore = store.subscribe((state) => {
    const status = state.save?.status || 'idle';
    if (status !== prevStatus) {
      prevStatus = status;
      win.piFlow?.setDirty?.(DIRTY_STATES.has(status));
    }

    const entered = Boolean(state.workspace?.entered);
    if (entered !== prevEntered) {
      prevEntered = entered;
      saver.reset();
    }
  });
  prevStatus = store.getState().save?.status || 'idle';
  prevEntered = Boolean(store.getState().workspace?.entered);
  win.piFlow?.setDirty?.(DIRTY_STATES.has(prevStatus));

  /* ---------- 点击保存 ---------- */

  const stopEvent = store.subscribeEvent(({ event, accepted }) => {
    if (!accepted) return;
    if (event.type !== EVENTS.WORKSPACE_SAVE_CLICKED) return;

    void (async () => {
      const ok = await saver.flush();
      if (!ok) {
        toast(t('保存失败'));
        void dispatch({
          type: EVENTS.WORKSPACE_SAVE_FAILED,
          kind: 'mutate',
          payload: { error: 'save failed' },
        });
        return;
      }
      void dispatch({ type: EVENTS.WORKSPACE_SAVED, kind: 'mutate', payload: {} });
    })();
  });

  /* ---------- 关窗询问（宿主桥） ---------- */

  async function saveAndClose() {
    const ok = await saver.flush();
    if (!ok) {
      toast(t('保存失败，窗口先不关'));
      win.piFlow?.respondClose?.('cancel');
      return;
    }
    win.piFlow?.respondClose?.('close');
  }

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
        win.piFlow?.respondClose?.(choice === 0 ? 'close' : 'cancel');
        return;
      }
      if (choice === 2) { win.piFlow?.respondClose?.('cancel'); return; }
      if (choice === 1) { win.piFlow?.respondClose?.('close'); return; }
      await saveAndClose();
      return;
    }

    if (dirty) {
      const choice = await confirmDialog({
        title: t('还有改动没保存'),
        message: t('当前流程有改动还没保存，要先保存吗？'),
        buttons: [t('保存并关闭'), t('不保存'), t('取消')],
      });
      if (choice === 2) { win.piFlow?.respondClose?.('cancel'); return; }
      if (choice === 1) { win.piFlow?.respondClose?.('close'); return; }
      await saveAndClose();
      return;
    }

    win.piFlow?.respondClose?.('close');
  }

  win.piFlow?.onCloseRequest?.((info = {}) => {
    void handleCloseRequest(Number(info.running) || 0, Boolean(info.dirty));
  });

  return {
    region: region.region,
    refresh: region.refresh,
    destroy() {
      stopEvent?.();
      stopStore?.();
      region.destroy();
    },
  };
}
