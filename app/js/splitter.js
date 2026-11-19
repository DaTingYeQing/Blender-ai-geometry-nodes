/* ===== UI：侧栏分割栏 =====
 * 侧栏宽度只有这一个组件关心、也只有它改，所以不出这个文件、不上总线。
 * 加总线是给"跨越组件边界"的动作用的，不是给所有状态用的。
 */

export function mountSplitter() {
  const sidebar = document.getElementById('sidebar');
  const splitter = document.getElementById('splitter');

  const MIN_PX = 180;      // 绝对下限：窗口很窄时也别窄过这个
  const MAX_PX = 480;      // 绝对上限：再宽就不像侧栏了
  const DEFAULT = 260;
  const MIN_RATIO = 0.25;  // 但无论如何，侧栏至少占窗口宽度的四分之一

  /* 下限跟着窗口走：宽屏上 1/4 可能比 480 还大，所以上限也要跟着抬，
   * 否则 max < min，拖不动也设不进去。 */
  function limits() {
    const min = Math.max(MIN_PX, Math.round(window.innerWidth * MIN_RATIO));
    /* 上限至少比下限再宽 240px，否则宽屏上"最小 1/4"会把侧栏锁死不能拖。 */
    return { min, max: Math.max(MAX_PX, min + 240) };
  }

  function setWidth(px) {
    const { min, max } = limits();
    sidebar.style.width = Math.max(min, Math.min(max, px)) + 'px';
  }

  function currentWidth() {
    return sidebar.getBoundingClientRect().width;
  }

  let dragging = false;
  let startX = 0;
  let startW = 0;

  /* 收尾必须集中在一个函数里：mouseup、窗口失焦、组件卸载都走它。
   * 原版只有 mouseup —— 拖到一半切走窗口，回来鼠标还粘在边框上。 */
  function stop() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging');
    splitter.classList.remove('active');
  }

  splitter.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    document.body.classList.add('dragging');
    splitter.classList.add('active');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    setWidth(startW + (e.clientX - startX));
  });

  window.addEventListener('mouseup', stop);
  window.addEventListener('blur', stop);   // 失焦兜底

  // 双击：恢复默认宽度（但不能低于窗口宽度的 1/4）
  splitter.addEventListener('dblclick', () => setWidth(Math.max(DEFAULT, limits().min)));

  /* 窗口尺寸变了，1/4 的下限也跟着变：变宽时把侧栏抬到新下限，
   * 变窄时保留当前宽度。 */
  window.addEventListener('resize', () => setWidth(currentWidth()));

  // 首屏先按当前窗口把下限补齐（CSS 里的 260px 只是兜底）
  setWidth(currentWidth());
}
