/* ===== 区域：主标题（hero）=====
 * 标题的位置完全由 workspace.entered 派生：进入工作区就“飞”到左上角，
 * 离开就清掉 transform 滑回中间。点击只发意图，具体保存确认与业务动作在组装根。
 *
 * 动画分层沿用旧实现：外层 h1 的 transform 负责飞行，内层 .logo-inner 负责点击弹跳。
 */

import { createRegionHost } from './region-host.js';
import { EVENTS } from '../contracts/events.js';

const REGION_ID = 'hero';

/**
 * @param {{
 *   parent: any,
 *   focus: any,
 *   dispatch: (event: any) => void,
 *   store: { getState: () => any, subscribe: (fn: () => void) => () => void },
 *   document: Document,
 *   translate?: (text: string) => string,
 *   logoClick?: HTMLElement,
 *   logoInner?: HTMLElement,
 *   mainArea?: HTMLElement,
 *   createResizeObserver?: (callback: () => void) => { observe?: (el: any) => void, disconnect?: () => void } | null,
 *   afterPop?: (done: () => void) => void,
 * }} options
 */
export function createHeroRegion({
  parent,
  focus,
  dispatch,
  store,
  document: doc,
  logoClick = doc?.getElementById?.('logoClick'),
  logoInner = doc?.getElementById?.('logoInner'),
  mainArea = doc?.getElementById?.('main'),
  createResizeObserver = typeof ResizeObserver === 'function'
    ? (callback) => new ResizeObserver(callback)
    : () => null,
  afterPop = (done) => done(),
}) {
  if (!doc) throw new Error('createHeroRegion: 需要 document');
  if (!store) throw new Error('createHeroRegion: 需要 store');
  if (!logoClick || !logoInner) throw new Error('createHeroRegion: 找不到标题元素');

  const host = createRegionHost({ id: REGION_ID, parent, focus, dispatch });

  function pinToCorner() {
    const dx = 16 - logoClick.offsetLeft;
    const dy = 10 - logoClick.offsetTop;
    logoClick.style.transform = `translate(${dx}px, ${dy}px) scale(0.28)`;
  }

  function apply(state = store.getState()) {
    const entered = Boolean(state.workspace?.entered);
    mainArea?.classList?.toggle('in-workspace', entered);
    if (entered) pinToCorner();
    else logoClick.style.transform = '';
  }

  /* 侧栏拖宽 / 窗口缩放后重算，标题始终钉在左上角。 */
  const observer = createResizeObserver?.(() => {
    if (store.getState().workspace?.entered) pinToCorner();
  });
  if (observer && mainArea) {
    observer.observe?.(mainArea);
    host.scope.add(() => observer.disconnect?.());
  }

  let popSeq = 0;

  const onClick = () => {
    if (store.getState().workspace?.entered) {
      host.requestFocus();
      host.emit({ type: EVENTS.WORKSPACE_LEAVE_CLICKED });
      return;
    }
    logoInner.classList?.remove('pop');
    void logoInner.offsetWidth;        // 强制重排，连点时动画也能重新触发
    logoInner.classList?.add('pop');

    /* 弹跳结束由组装根用 AnimationPort 等；区域不直接挂 animationend。 */
    const seq = ++popSeq;
    afterPop(() => {
      if (seq !== popSeq) return;
      logoInner.classList?.remove('pop');
      host.requestFocus();
      host.emit({
        type: EVENTS.PANEL_OPEN_CLICKED,
        payload: { id: 'logoPanel' },
      });
    });
  };

  function onKeydown(event) {
    if (event?.key !== 'Enter' && event?.key !== ' ') return;
    event.preventDefault?.();
    onClick();
  }

  logoClick.addEventListener('click', onClick);
  logoClick.addEventListener('keydown', onKeydown);
  host.scope.add(() => {
    popSeq += 1;                       // 卸载后回调不再发事件
    logoClick.removeEventListener?.('click', onClick);
    logoClick.removeEventListener?.('keydown', onKeydown);
  });

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
