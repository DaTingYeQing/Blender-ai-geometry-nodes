/* ===== 区域错误边界 =====
 * common.md：一个组件渲染抛错，不应该让整个 UI 空白；每个区域要有局部 fallback。
 *
 * 边界只包住“区域自己的一次渲染”：抛错时把容器换成一块明确的降级提示，
 * 同一个错误不会每帧重试刷屏；reset() 留给用户重试或下一次换屏。
 *
 * 组件级兜底在 registry 里（工厂抛错、update 抛错），这里只兜区域级。
 */

/**
 * @param {{
 *   container: HTMLElement,
 *   document: Document,
 *   regionId?: string,
 *   title?: string,
 *   onError?: (error: unknown) => void,
 * }} options
 */
export function createErrorBoundary({
  container,
  document,
  regionId = '',
  title = '此区域暂时不可用',
  onError,
} = {}) {
  if (!container) throw new Error('createErrorBoundary: 需要 container');
  if (!document) throw new Error('createErrorBoundary: 需要 document');

  let failed = false;

  /** 渲染失败的占位：位置不变、内容明确、对读屏可见。 */
  function show(error) {
    failed = true;
    try {
      onError?.(error);
    } catch {
      /* 记录员自己坏了，不能影响降级本身。 */
    }

    const box = document.createElement('div');
    box.className = 'region-error';
    box.setAttribute('role', 'alert');
    box.setAttribute('data-region', regionId);

    const line = document.createElement('p');
    line.textContent = title;
    box.appendChild(line);

    const detail = document.createElement('p');
    detail.className = 'region-error-detail';
    detail.textContent = String(error?.message || error || '');
    box.appendChild(detail);

    container.replaceChildren(box);
  }

  /**
   * 跑一次渲染。失败时返回 false 并显示 fallback；已失败则直接跳过。
   * @param {() => unknown} render
   * @returns {boolean} 是否渲染成功
   */
  function run(render) {
    if (failed) return false;
    try {
      render();
      return true;
    } catch (error) {
      show(error);
      return false;
    }
  }

  return {
    run,
    reset() {
      failed = false;
    },
    get failed() {
      return failed;
    },
  };
}
