/* ===== 区域：手动保存按钮 =====
 * 只把新状态投影到现有按钮：显隐看 workspace.entered，文案/颜色看 save.status。
 * 点击发 workspace.save.clicked，真正落盘由组装根的保存控制器调用 saver.flush()。
 */

import { createRegionHost } from './region-host.js';
import { EVENTS } from '../contracts/events.js';

const REGION_ID = 'save';

/**
 * @param {{
 *   parent: any,
 *   focus: any,
 *   dispatch: (event: any) => void,
 *   store: { getState: () => any, subscribe: (fn: () => void) => () => void },
 *   document: Document,
 *   translate?: (text: string) => string,
 *   button?: HTMLElement,
 * }} options
 */
export function createSaveButtonRegion({
  parent,
  focus,
  dispatch,
  store,
  document: doc,
  translate = (text) => text,
  button = doc?.getElementById?.('saveBtn'),
}) {
  if (!doc) throw new Error('createSaveButtonRegion: 需要 document');
  if (!store) throw new Error('createSaveButtonRegion: 需要 store');
  if (!button) throw new Error('createSaveButtonRegion: 找不到 #saveBtn');

  const t = translate;
  const host = createRegionHost({ id: REGION_ID, parent, focus, dispatch });
  const textEl = button.querySelector?.('.save-text');

  function onOpen() {
    if (button.dataset.state === 'saving') return;
    host.requestFocus();
    host.emit({ type: EVENTS.WORKSPACE_SAVE_CLICKED });
  }

  button.hidden = true;
  button.addEventListener('click', onOpen);
  host.scope.add(() => button.removeEventListener?.('click', onOpen));

  function apply(state = store.getState()) {
    const entered = Boolean(state.workspace?.entered);
    if (button.hidden === entered) button.hidden = !entered;

    const status = state.save?.status || 'idle';
    if (button.dataset.state !== status) button.dataset.state = status;

    const label = status === 'saved'
      ? t('成功')
      : status === 'failed'
        ? t('失败')
        : t('保存');
    if (textEl && textEl.textContent !== label) textEl.textContent = label;

    const title = status === 'dirty' ? t('有未保存的改动') : t('保存流程');
    if (button.title !== title) button.title = title;
  }

  const stop = store.subscribe(apply);
  host.scope.add(stop);
  apply();

  return {
    region: host,
    refresh: () => apply(),
    destroy() {
      host.destroy();
    },
  };
}
