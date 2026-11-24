/* ===== 区域：产物查看器 =====
 * 右侧面板的显隐、色条、宽度拖拽在这里；正文由组件画、内容由 ArtifactReadModel 提供。
 * 打开是 sidebar 发的 artifact.open.clicked，关闭是本区域发的 artifact.close.clicked。
 * 宽度只属于这个面板，保持视图本地，不进状态。
 */

import { createRegionHost } from './region-host.js';
import { createErrorBoundary } from './error-boundary.js';
import { createComponentRegistry } from '../components/registry.js';
import {
  registerArtifactComponents,
  ARTIFACT_COMPONENT,
} from '../components/artifact/index.js';
import { EVENTS } from '../contracts/events.js';

const REGION_ID = 'artifact';
const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 420;
const GAP = 240;            // 主区域至少留这么宽，右侧栏再大也不能把画布挤没

/**
 * @param {{
 *   parent: any,
 *   focus: any,
 *   dispatch: (event: any) => void,
 *   store: { getState: () => any, subscribe: (fn: () => void) => () => void },
 *   readModel: { peekContent?: (path: string) => string | null },
 *   document: Document,
 *   translate?: (text: string) => string,
 *   pane?: HTMLElement,
 *   splitter?: HTMLElement,
 *   sidebar?: HTMLElement,
 * }} options
 */
export function createArtifactRegion(options) {
  const {
    parent,
    focus,
    dispatch,
    store,
    readModel = {},
    document: doc,
    translate = (text) => text,
    pane = doc?.getElementById?.('artifactPane'),
    splitter = doc?.getElementById?.('artifactSplitter'),
    sidebar = doc?.getElementById?.('sidebar'),
  } = options;

  if (!doc) throw new Error('createArtifactRegion: 需要 document');
  if (!store) throw new Error('createArtifactRegion: 需要 store');
  if (!pane) throw new Error('createArtifactRegion: 找不到 #artifactPane');

  const t = translate;
  const win = doc.defaultView ?? globalThis;
  const host = createRegionHost({ id: REGION_ID, parent, focus, dispatch });

  const registry = createComponentRegistry({ document: doc });
  registerArtifactComponents({ registry, document: doc });

  pane.replaceChildren();
  pane.hidden = true;
  if (splitter) splitter.hidden = true;

  const view = registry.render(
    { type: ARTIFACT_COMPONENT.VIEW, props: {} },
    { emit: host.emit, requestFocus: () => host.requestFocus() },
  );
  pane.appendChild(view.el);
  host.registerChild(view);

  const boundary = createErrorBoundary({
    container: pane,
    document: doc,
    regionId: REGION_ID,
    title: t('产物查看器暂时不可用'),
    onError: (error) => {
      console.error(`[区域] ${REGION_ID} 渲染失败`, error);
      void dispatch({
        type: EVENTS.REGION_RENDER_FAILED,
        kind: 'observe',
        payload: { regionId: REGION_ID, message: String(error?.message || error) },
      });
    },
  });
  host.scope.add(() => boundary.reset?.());

  /* ---------- 宽度（视图本地） ---------- */

  let width = DEFAULT_WIDTH;
  let dragging = false;
  let startX = 0;
  let startW = 0;

  function limits() {
    const left = sidebar?.getBoundingClientRect
      ? sidebar.getBoundingClientRect().width
      : 260;
    const innerWidth = Number(win?.innerWidth) || 0;
    if (!innerWidth) return { min: MIN_WIDTH, max: Number.POSITIVE_INFINITY };
    return {
      min: MIN_WIDTH,
      max: Math.max(MIN_WIDTH, Math.round(innerWidth - left - GAP)),
    };
  }

  function setWidth(px) {
    const { min, max } = limits();
    width = Math.max(min, Math.min(max, px));
    pane.style.width = `${width}px`;
  }

  function stopDrag() {
    if (!dragging) return;
    dragging = false;
    doc.body?.classList?.remove('ap-dragging');
  }

  if (splitter) {
    const onDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      startX = event.clientX;
      startW = pane.getBoundingClientRect().width;
      doc.body?.classList?.add('ap-dragging');
      event.preventDefault();
    };
    const onMove = (event) => {
      if (!dragging) return;
      setWidth(startW - (event.clientX - startX));   // 往左拖 = 变宽
    };
    const onResize = () => {
      if (pane.hidden) return;
      setWidth(width);
    };

    splitter.addEventListener('mousedown', onDown);
    win.addEventListener?.('mousemove', onMove);
    win.addEventListener?.('mouseup', stopDrag);
    win.addEventListener?.('blur', stopDrag);
    win.addEventListener?.('resize', onResize);

    host.scope.add(() => {
      splitter.removeEventListener?.('mousedown', onDown);
      win.removeEventListener?.('mousemove', onMove);
      win.removeEventListener?.('mouseup', stopDrag);
      win.removeEventListener?.('blur', stopDrag);
      win.removeEventListener?.('resize', onResize);
      stopDrag();
    });
  }

  /* ---------- 状态 → 视图 ---------- */

  function apply(state = store.getState()) {
    boundary.run(() => render(state));
  }

  function render(state) {
    const artifact = state.artifact || {};
    if (!artifact.open) {
      pane.hidden = true;
      if (splitter) splitter.hidden = true;
      return;
    }

    pane.hidden = false;
    if (splitter) splitter.hidden = false;
    setWidth(width);
    pane.style.setProperty?.('--ap-team', artifact.color || 'var(--border)');

    const content = artifact.status === 'success' && artifact.previewable !== false
      ? readModel.peekContent?.(artifact.path) ?? null
      : null;

    view.update({
      name: artifact.name,
      path: artifact.path,
      status: artifact.status,
      previewable: artifact.previewable !== false,
      error: artifact.error,
      content,
      closeLabel: t('关闭'),
      loadingText: t('加载中…'),
      failedText: t('读取失败'),
      unsupportedText: t('这个文件类型不支持预览'),
    });
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
