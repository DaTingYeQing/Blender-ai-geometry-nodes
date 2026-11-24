/* ===== 组装根：主标题（hero）=====
 * 区域只负责位置与点击意图；这里把“离开前先保存”接上，并注入弹跳收尾。
 * 打开设置面板时区域直接发 panel.open.clicked，面板显隐以新状态为准。
 * 离开工作区只需回一条 workspace.left：entered 与画布切片都由 reducer 收尾。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createHeroRegion } from '../ui/regions/hero.js';
import { ANIMATION_NAMES } from '../ui/animator/animation-names.js';
import { confirmDialog } from '../ui/platform/confirm.js';

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   saver: { flush: () => Promise<boolean> },
 *   animation?: import('../ui/contracts/ports.js').AnimationPort,
 *   document?: Document,
 *   translate?: (text: string) => string,
 *   toast?: (message: string) => void,
 * }} options
 */
export function mountHeroPilot({
  kernel,
  saver,
  animation,
  document: doc = globalThis.document,
  translate = (text) => text,
  toast = (message) => console.warn('[hero]', message),
}) {
  if (!kernel) throw new Error('mountHeroPilot: 需要 kernel');
  if (typeof saver?.flush !== 'function') throw new Error('mountHeroPilot: 需要 saver.flush()');
  if (!doc) throw new Error('mountHeroPilot: 需要 document');

  const { store, focus, root, dispatch } = kernel;
  const t = translate;

  const region = createHeroRegion({
    parent: root,
    focus,
    dispatch,
    store,
    document: doc,
    translate: t,
    afterPop: (done) => {
      const logoInner = doc.getElementById?.('logoInner');
      const waited = animation?.waitUntilDone?.(logoInner, {
        animationName: ANIMATION_NAMES.pop,
        timeoutMs: 400,
      });
      Promise.resolve(waited).then(done, done);
    },
  });

  /* 离开前：dirty / failed 才问；保存失败不离开。 */
  async function ensureSaved() {
    const status = store.getState().save?.status;
    if (status !== 'dirty' && status !== 'failed') return true;

    const choice = await confirmDialog({
      title: t('还有改动没保存'),
      message: t('离开工作区前，要先保存这个流程吗？'),
      buttons: [t('保存并离开'), t('不保存'), t('取消')],
    });
    if (choice === 2) return false;
    if (choice === 1) return true;

    const ok = await saver.flush();
    if (!ok) {
      toast(t('保存失败，先别离开'));
      return false;
    }
    return true;
  }

  const stopEvent = store.subscribeEvent(({ event, accepted }) => {
    if (!accepted) return;

    if (event.type === EVENTS.WORKSPACE_LEAVE_CLICKED) {
      void (async () => {
        if (!(await ensureSaved())) return;
        try {
          /* entered 置空、画布切片清空、聚焦收起都由 reducer 处理。 */
          void dispatch({ type: EVENTS.WORKSPACE_LEFT, kind: 'mutate', payload: {} });
        } catch (error) {
          toast(t('暂时无法离开工作区'));
          console.warn('[hero] workspace.leave', error);
        }
      })();
      return;
    }

  });

  return {
    region: region.region,
    refresh: region.refresh,
    destroy() {
      stopEvent?.();
      region.destroy();
    },
  };
}
